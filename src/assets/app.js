/* Interview Prep Hub — plain JS, no build step. Works from file:// and http(s). */
(() => {
'use strict';

const TOPICS = window.SITE_TOPICS, CATS = window.SITE_CATS, READY = new Set(window.SITE_READY || []);
const BY_SLUG = Object.fromEntries(TOPICS.map(t => [t.slug, t]));
const CAT = Object.fromEntries(CATS.map(c => [c.id, c]));
const LEVELS = ['Basic', 'Intermediate', 'Senior', 'Principal'];
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => Array.from(el.querySelectorAll(s));
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

/* ---------- persisted state ---------- */
const KEY = 'iq.v1';
const defaults = () => ({ theme: null, last: null, cats: {}, side: false, rev: {}, bm: {}, rate: {}, chk: {}, seen: {} });
let S = (() => { try { return Object.assign(defaults(), JSON.parse(localStorage.getItem(KEY) || '{}')); } catch { return defaults(); } })();
const save = () => { try { localStorage.setItem(KEY, JSON.stringify(S)); } catch { /* storage blocked: app still works */ } };
const kq = (slug, id) => slug + '/' + id;
const isRev = (slug, id) => !!S.rev[kq(slug, id)];
const isBm = (slug, id) => !!S.bm[kq(slug, id)];
const topicRevCount = slug => Object.keys(S.rev).filter(k => k.startsWith(slug + '/')).length;
const topicCount = t => (t.loaded ? t.loaded.questions.length : t.count);
const pct = (a, b) => b ? Math.min(100, Math.round(a / b * 100)) : 0;

/* ---------- toast / confetti ---------- */
function toast(msg) { $('#toastBody').textContent = msg; bootstrap.Toast.getOrCreateInstance($('#toast'), { delay: 2200 }).show(); }
function confetti() {
  if (reduceMotion) return;
  const colors = ['#4f46e5', '#16a34a', '#f59e0b', '#db2777', '#0891b2'];
  for (let i = 0; i < 70; i++) {
    const d = document.createElement('i'); d.className = 'confetti';
    d.style.left = Math.random() * 100 + 'vw'; d.style.background = colors[i % colors.length];
    d.style.animationDelay = Math.random() * .5 + 's'; d.style.animationDuration = 1.4 + Math.random() * 1.2 + 's';
    document.body.appendChild(d); setTimeout(() => d.remove(), 3200);
  }
}

/* ---------- theme ---------- */
function curTheme() { return document.documentElement.getAttribute('data-bs-theme'); }
function applyTheme(t, persist) {
  document.documentElement.setAttribute('data-bs-theme', t);
  $('#hljs-light').disabled = t === 'dark'; $('#hljs-dark').disabled = t !== 'dark';
  $('#themeBtn').innerHTML = t === 'dark' ? '<i class="bi bi-sun"></i>' : '<i class="bi bi-moon-stars"></i>';
  $('#themeBtn').setAttribute('aria-pressed', t === 'dark');
  if (persist) { S.theme = t; save(); }
  rerenderDiagrams();
}

/* ---------- mini markdown (authoring format for question data) ---------- */
// ~~~lang fences, ~~~mermaid diagrams, ### headings, - / 1. lists, | tables |, **bold**, *em*, {{inline code}}
// authoring escapes for String.raw data files: $\{ -> ${ and ` -> backtick
const unraw = s => String(s).replace(/\$\\{/g, '${').replace(/\\x60/g, '`');
function inline(t) {
  const codes = [];
  t = esc(unraw(t)).replace(/\{\{(.+?)\}\}(?!\})/g, (m, c) => { codes.push(c); return '\u0002' + (codes.length - 1) + '\u0002'; });
  t = t.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>').replace(/(^|[\s(])\*(?![\s*])(.+?)\*(?=[\s).,;:!?]|$)/g, '$1<em>$2</em>');
  return t.replace(/\u0002(\d+)\u0002/g, (m, i) => '<code>' + codes[i] + '</code>');
}
function codeBlock(lang, code) {
  const lines = code.split('\n').length;
  const gutter = lines > 10 ? '<div class="cb-gutter" aria-hidden="true">' + Array.from({ length: lines }, (_, i) => i + 1).join('\n') + '</div>' : '';
  return `<div class="codeblock"><div class="cb-head"><span class="cb-lang">${esc(lang || 'text')}</span><button type="button" class="btn btn-sm btn-link cb-copy" data-act="copy" aria-label="Copy code"><i class="bi bi-clipboard"></i> Copy</button></div>` +
    `<div class="cb-body">${gutter}<pre tabindex="0"><code class="language-${esc(lang || 'plaintext')}">${esc(code)}</code></pre></div></div>`;
}
function diagramBlock(code) {
  return `<figure class="diagram" data-code="${esc(code)}"><div class="dg-tools"><button type="button" class="btn btn-sm btn-outline-secondary" data-act="zoom" aria-label="Open diagram full screen"><i class="bi bi-arrows-fullscreen"></i></button></div><div class="dg-canvas placeholder-glow" role="img" aria-label="Architecture diagram"><span class="placeholder col-8"></span></div></figure>`;
}
function md(src, pfx = 'h') {
  if (!src) return '';
  const fences = []; let hid = 0;
  src = unraw(src).replace(/~~~(\w*)\n([\s\S]*?)\n~~~/g, (m, l, c) => { fences.push([l, c]); return '\n\n\u0001' + (fences.length - 1) + '\u0001\n\n'; });
  // line-based: headings, tables, lists and paragraphs may follow each other without blank lines
  const out = [], heads = [], lines = src.trim().split('\n');
  let para = [];
  const flush = () => { if (para.length) { out.push('<p>' + inline(para.join(' ')) + '</p>'); para = []; } };
  const isTable = l => /^\s*\|.*\|\s*$/.test(l);
  const listRe = /^(\s*)([-*]|\d+\.)\s+(.*)$/;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i], t = line.trim();
    if (!t) { flush(); continue; }
    let m = t.match(/^\u0001(\d+)\u0001$/);
    if (m) { flush(); const [l, c] = fences[+m[1]]; out.push(l === 'mermaid' ? diagramBlock(c) : codeBlock(l, c)); continue; }
    if ((m = t.match(/^#{2,4}\s+(.*)$/))) { flush(); const id = pfx + '-' + (hid++); heads.push([id, m[1]]); out.push(`<h5 id="${id}">${inline(m[1])}</h5>`); continue; }
    if (isTable(line)) {
      flush(); const rows = [];
      while (i < lines.length && isTable(lines[i])) rows.push(lines[i++].trim().replace(/^\||\|$/g, '').split('|').map(c => c.trim()));
      i--;
      const sep = rows[1] && rows[1].every(c => /^:?-{2,}:?$/.test(c)); const head = rows[0], body = rows.slice(sep ? 2 : 1);
      out.push('<div class="table-responsive"><table class="table table-sm table-striped table-bordered align-middle"><thead><tr>' + head.map(c => `<th scope="col">${inline(c)}</th>`).join('') + '</tr></thead><tbody>' +
        body.map(r => '<tr>' + r.map(c => `<td>${inline(c)}</td>`).join('') + '</tr>').join('') + '</tbody></table></div>'); continue;
    }
    if ((m = line.match(listRe))) {
      flush();
      const ordered = /\d/.test(m[2]), base = m[1].length, items = [];
      while (i < lines.length) {
        const l = lines[i], lm = l.match(listRe);
        if (lm && lm[1].length <= base + 1) { if (/\d/.test(lm[2]) !== ordered) break; items.push({ text: lm[3], sub: [] }); i++; continue; }
        if (lm && lm[1].length > base + 1 && items.length) { items[items.length - 1].sub.push(lm[3]); i++; continue; }        // nested item
        if (l.trim() && /^\s{2,}/.test(l) && items.length) { items[items.length - 1].text += ' ' + l.trim(); i++; continue; } // continuation
        break;
      }
      i--;
      const tag = ordered ? 'ol' : 'ul';
      out.push(`<${tag}>` + items.map(it => `<li>${inline(it.text)}${it.sub.length ? '<ul>' + it.sub.map(s => `<li>${inline(s)}</li>`).join('') + '</ul>' : ''}</li>`).join('') + `</${tag}>`);
      continue;
    }
    if ((m = t.match(/^>\s?(.*)$/))) { flush(); out.push(`<blockquote class="callout-quote">${inline(m[1])}</blockquote>`); continue; }
    para.push(t);
  }
  flush();
  md.heads = heads; return out.join('\n');
}
const plain = s => String(s || '').replace(/~~~[\s\S]*?~~~/g, ' ').replace(/[*#{}|`]/g, '');

/* ---------- topic data loading ---------- */
window.registerTopic = (slug, data) => { const t = BY_SLUG[slug]; if (t) { t.loaded = data; } };
const loading = {};
function loadTopic(t) {
  if (t.loaded) return Promise.resolve(t);
  if (loading[t.slug]) return loading[t.slug];
  return loading[t.slug] = new Promise((res, rej) => {
    const s = document.createElement('script'); s.src = t.data + '?v=' + (window.SITE_UPDATED || '1'); s.async = true;
    s.onload = () => { delete loading[t.slug]; t.loaded ? res(t) : rej(new Error('Data file loaded but did not register topic ' + t.slug)); };
    s.onerror = () => { delete loading[t.slug]; s.remove(); rej(new Error('Could not load ' + t.data)); };
    document.head.appendChild(s);
  });
}
const allReady = () => TOPICS.filter(t => READY.has(t.slug));
const loadAllReady = () => Promise.allSettled(allReady().map(loadTopic));

/* ---------- sidebar ---------- */
function sidebarHtml() {
  let h = `<div class="sb-filter"><label class="visually-hidden" for="sbq">Filter topics</label><input id="sbq" class="form-control form-control-sm sbq" type="search" placeholder="Filter topics…" autocomplete="off"></div><nav aria-label="Topic list">`;
  const q = (sidebarHtml.q || '').toLowerCase();
  for (const c of CATS) {
    const ts = TOPICS.filter(t => t.cat === c.id && (!q || (t.title + ' ' + t.n).toLowerCase().includes(q)));
    if (!ts.length) continue;
    const open = q ? true : S.cats[c.id] !== false && (S.cats[c.id] === true || c.id === 'lang' || activeCat() === c.id);
    h += `<button type="button" class="sb-cat" style="--cat:${c.color}" data-cat="${c.id}" aria-expanded="${open}"><i class="bi ${c.icon}" aria-hidden="true"></i><span>${esc(c.name)}</span><i class="bi bi-chevron-down chev" aria-hidden="true"></i></button>`;
    h += `<ul class="sb-list" ${open ? '' : 'hidden'} style="--cat:${c.color}">`;
    for (const t of ts) {
      const rv = topicRevCount(t.slug), ready = READY.has(t.slug);
      h += `<li><a class="sb-item ${t.slug === state.slug ? 'active' : ''} ${ready ? '' : 'soon'}" href="#/${t.slug}" data-slug="${t.slug}" ${t.slug === state.slug ? 'aria-current="page"' : ''}>` +
        `<span class="num">${t.n}</span><i class="bi ${t.icon}" aria-hidden="true"></i><span class="title">${esc(t.title)}</span>` +
        `<span class="badge ${t.slug === state.slug ? 'text-bg-light' : 'text-bg-secondary'}" title="${ready ? 'Questions' : 'Being written'}">${ready ? topicCount(t) : '–'}</span>` +
        `<span class="prog"><i style="width:${pct(rv, t.count)}%"></i></span></a></li>`;
    }
    h += '</ul>';
  }
  return h + '</nav>';
}
function activeCat() { return state.slug && BY_SLUG[state.slug] ? BY_SLUG[state.slug].cat : null; }
function renderSidebar(keepFocus) {
  const had = document.activeElement && document.activeElement.classList.contains('sbq');
  const pos = had ? document.activeElement.selectionStart : 0;
  for (const el of [$('#sbDesktop'), $('#sbMobile')]) {
    const st = el.scrollTop; el.innerHTML = sidebarHtml(); el.scrollTop = st;
    const inp = $('.sbq', el); inp.value = sidebarHtml.q || '';
  }
  if (had && keepFocus) { const i = $('.sbq', $('#sbDesktop').offsetParent ? $('#sbDesktop') : $('#sbMobile')); i.focus(); i.setSelectionRange(pos, pos); }
}
function bindSidebar() {
  for (const el of [$('#sbDesktop'), $('#sbMobile')]) {
    el.addEventListener('click', e => {
      const cb = e.target.closest('.sb-cat');
      if (cb) { const open = cb.getAttribute('aria-expanded') !== 'true'; S.cats[cb.dataset.cat] = open; save(); cb.setAttribute('aria-expanded', open); cb.nextElementSibling.hidden = !open; return; }
      if (e.target.closest('.sb-item')) bootstrap.Offcanvas.getInstance($('#sbCanvas'))?.hide();
    });
    el.addEventListener('input', e => { if (e.target.classList.contains('sbq')) { sidebarHtml.q = e.target.value; renderSidebar(true); } });
    el.addEventListener('keydown', e => { // arrow-key navigation
      if (!['ArrowDown', 'ArrowUp'].includes(e.key)) return;
      const items = $$('.sb-cat, .sb-list:not([hidden]) .sb-item, .sbq', el), i = items.indexOf(document.activeElement);
      if (i < 0) return; e.preventDefault(); items[Math.max(0, Math.min(items.length - 1, i + (e.key === 'ArrowDown' ? 1 : -1)))].focus();
    });
  }
}

/* ---------- routing ---------- */
const state = { slug: null, qid: null, filters: { level: '', status: '', tag: '' }, cursor: -1 };
function parseHash() { return location.hash.replace(/^#\/?/, '').split('/').filter(Boolean).map(decodeURIComponent); }
async function route() {
  const p = parseHash(); const view = $('#view');
  state.slug = null; state.qid = null; state.cursor = -1;
  window.scrollTo(0, 0);
  if (!p.length) { document.title = 'Interview Prep Hub'; renderSidebar(); return renderHome(view); }
  if (p[0] === 'bookmarks') { state.slug = null; renderSidebar(); document.title = 'Bookmarks · Interview Prep Hub'; return renderBookmarks(view); }
  if (p[0] === 'checklist') { renderSidebar(); document.title = 'Interview-day checklist'; return renderChecklist(view); }
  if (p[0] === 'flash') { renderSidebar(); return renderFlash(view, p[1] || 'all'); }
  const t = BY_SLUG[p[0]];
  if (!t) { renderSidebar(); view.innerHTML = notFound(); return; }
  state.slug = t.slug; state.qid = p[1] || null; S.last = { slug: t.slug, q: state.qid }; save();
  renderSidebar(); document.title = t.title + ' · Interview Prep Hub';
  await renderTopic(view, t);
  focusMain();
}
function focusMain() { const h = $('#view h1'); if (h) { h.setAttribute('tabindex', '-1'); h.focus({ preventScroll: true }); } }
const notFound = () => `<div class="text-center py-5"><i class="bi bi-compass display-4 text-body-secondary"></i><h1 class="h3 mt-3">Page not found</h1><a class="btn btn-brand mt-2" href="#/">Back to dashboard</a></div>`;

/* ---------- dashboard ---------- */
function ring(p, color, label) {
  return `<svg class="ring" viewBox="0 0 64 64" style="--p:${p / 100};--cat:${color}" role="img" aria-label="${esc(label)} ${p}% complete"><circle class="bg" cx="32" cy="32" r="26"/><circle class="fg" cx="32" cy="32" r="26"/><text x="32" y="37" text-anchor="middle">${p}%</text></svg>`;
}
function overall() { const total = TOPICS.reduce((a, t) => a + t.count, 0), rv = Object.keys(S.rev).length; return { total, rv, p: pct(rv, total) }; }
function renderHome(view) {
  const o = overall(), last = S.last && BY_SLUG[S.last.slug];
  view.innerHTML = `
  <section class="hero mb-4"><div class="row align-items-center g-3"><div class="col-lg-8">
    <h1 class="display-6 fw-bold mb-2">Interview Prep Hub</h1>
    <p class="lead mb-3">Lead · Principal · Full-Stack (.NET + Angular/React). ${TOPICS.length} topics, 50 questions each, ordered from fundamentals to principal level.</p>
    <div class="d-flex flex-wrap gap-2">
      ${last ? `<a class="btn btn-brand btn-lg" href="#/${last.slug}${S.last.q ? '/' + S.last.q : ''}"><i class="bi bi-play-fill"></i> Continue: ${esc(last.title)}</a>` : `<a class="btn btn-brand btn-lg" href="#/${TOPICS[0].slug}"><i class="bi bi-play-fill"></i> Start with ${esc(TOPICS[0].title)}</a>`}
      <a class="btn btn-outline-secondary btn-lg" href="#/flash/all"><i class="bi bi-stopwatch"></i> Mock interview</a>
      <a class="btn btn-outline-secondary btn-lg" href="#/checklist"><i class="bi bi-check2-square"></i> Interview-day checklist</a>
    </div></div>
    <div class="col-lg-4"><div class="d-flex justify-content-between small mb-1"><span>Overall progress</span><span>${o.rv} / ${o.total} reviewed</span></div>
      <div class="progress" role="progressbar" aria-label="Overall progress" aria-valuenow="${o.p}" aria-valuemin="0" aria-valuemax="100"><div class="progress-bar" style="width:${o.p}%"></div></div>
      <div class="small text-body-secondary mt-2">${READY.size} of ${TOPICS.length} topics written so far.</div></div></div></section>
  <section class="mb-4" id="qotd" aria-label="Question of the day"></section>
  <h2 class="h5 mb-3">Categories</h2>
  <div class="row g-3">${CATS.map(c => {
    const ts = TOPICS.filter(t => t.cat === c.id), total = ts.reduce((a, t) => a + t.count, 0), rv = ts.reduce((a, t) => a + topicRevCount(t.slug), 0);
    return `<div class="col-12 col-md-6 col-xl-4"><div class="card cat-card" style="--cat:${c.color}"><div class="card-body">
      <div class="d-flex align-items-center gap-3 mb-3">${ring(pct(rv, total), c.color, c.name)}<div><h3 class="h6 mb-0"><i class="bi ${c.icon} me-1" style="color:${c.color}"></i>${esc(c.name)}</h3><div class="small text-body-secondary">${ts.length} topics · ${rv}/${total} reviewed</div></div></div>
      <div class="d-flex flex-wrap gap-1">${ts.map(t => `<a class="chip" href="#/${t.slug}">${t.n} ${esc(t.title)}</a>`).join('')}</div></div></div></div>`;
  }).join('')}</div>`;
  renderQotd();
}
async function renderQotd() {
  const box = $('#qotd'); if (!box) return;
  const ready = allReady();
  if (!ready.length) { box.innerHTML = `<div class="alert alert-secondary mb-0"><i class="bi bi-lightbulb me-1"></i>Question of the day appears once the first topic is written.</div>`; return; }
  const day = Math.floor(Date.now() / 864e5), t = ready[day % ready.length];
  try { await loadTopic(t); } catch { box.innerHTML = ''; return; }
  const qs = t.loaded.questions, q = qs[(day * 7) % qs.length];
  box.innerHTML = `<div class="card border-0 shadow-sm"><div class="card-body d-flex flex-wrap gap-3 align-items-center justify-content-between">
    <div><div class="small text-uppercase fw-bold text-body-secondary mb-1"><i class="bi bi-lightbulb"></i> Question of the day · ${esc(t.title)}</div><div class="h5 mb-0">${esc(q.q)}</div></div>
    <a class="btn btn-brand" href="#/${t.slug}/${q.id}">Answer it <i class="bi bi-arrow-right"></i></a></div></div>`;
}

/* ---------- topic view ---------- */
function readMins(q) {
  const words = plain([q.a, q.ex, (q.pts || []).join(' '), (q.pit || []).join(' ')].join(' ')).split(/\s+/).length;
  return Math.max(1, Math.round(words / 200));
}
async function renderTopic(view, t) {
  const cat = CAT[t.cat], idx = TOPICS.indexOf(t);
  const crumbs = `<nav aria-label="breadcrumb" class="no-print"><ol class="breadcrumb mb-2"><li class="breadcrumb-item"><a href="#/">Home</a></li><li class="breadcrumb-item">${esc(cat.name)}</li><li class="breadcrumb-item active" aria-current="page">${esc(t.title)}</li></ol></nav>`;
  view.style.setProperty('--cat', cat.color);
  if (!READY.has(t.slug)) {
    view.innerHTML = crumbs + `<h1 class="h2">${esc(t.n)} · ${esc(t.title)}</h1><div class="card my-4"><div class="card-body text-center py-5"><i class="bi bi-hourglass-split display-4 text-body-secondary"></i><h2 class="h5 mt-3">This topic is still being written</h2>
      <p class="text-body-secondary mb-3">Its 50 questions have not been authored yet. The long-form study notes for it already exist in the repository folder <code>${esc(t.folder)}/</code>.</p><a class="btn btn-brand" href="#/">Back to dashboard</a></div></div>` + prevNext(idx);
    return;
  }
  view.innerHTML = crumbs + `<h1 class="h2">${esc(t.title)}</h1><div class="placeholder-glow mt-3" aria-busy="true" aria-label="Loading questions">${Array.from({ length: 6 }, () => '<div class="card mb-2"><div class="card-body"><span class="placeholder col-9"></span></div></div>').join('')}</div>`;
  try { await loadTopic(t); } catch (err) {
    view.innerHTML = crumbs + `<h1 class="h2">${esc(t.title)}</h1><div class="alert alert-danger d-flex align-items-center gap-3 mt-3" role="alert"><i class="bi bi-wifi-off fs-3"></i><div class="flex-grow-1"><strong>Could not load this topic.</strong><div class="small">${esc(err.message)}. Check your connection and try again.</div></div><button class="btn btn-danger" id="retry">Retry</button></div>`;
    $('#retry').onclick = () => route(); return;
  }
  const d = t.loaded, qs = d.questions, rv = topicRevCount(t.slug);
  const tags = [...new Set(qs.flatMap(q => q.tags || []))].sort();
  view.innerHTML = crumbs + `
  <div class="topic-head mb-3"><div class="d-flex flex-wrap justify-content-between align-items-start gap-2">
    <div><h1 class="h2 mb-1"><i class="bi ${t.icon}" style="color:${cat.color}"></i> ${esc(t.title)} <small class="text-body-secondary fs-6">#${t.n}</small></h1><span class="badge badge-cat">${esc(cat.name)}</span></div>
    <div class="d-flex flex-wrap gap-2 no-print"><a class="btn btn-outline-secondary btn-sm" href="#/flash/${t.slug}"><i class="bi bi-stopwatch"></i> Flashcards</a>
      <button class="btn btn-outline-secondary btn-sm" data-act="expand"><i class="bi bi-arrows-expand"></i> Expand all</button>
      <button class="btn btn-outline-secondary btn-sm" data-act="collapse"><i class="bi bi-arrows-collapse"></i> Collapse all</button>
      <button class="btn btn-outline-secondary btn-sm" data-act="print"><i class="bi bi-printer"></i> Print</button>
      <a class="btn btn-outline-secondary btn-sm" href="#cheat"><i class="bi bi-card-checklist"></i> Cheat sheet</a></div></div>
    <div class="mt-3"><div class="d-flex justify-content-between small mb-1"><span>Topic progress</span><span id="tpText">${rv} / ${qs.length} reviewed</span></div>
      <div class="progress" role="progressbar" aria-label="Topic progress" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${pct(rv, qs.length)}" id="tpBar"><div class="progress-bar" style="width:${pct(rv, qs.length)}%"></div></div></div></div>
  <div class="row g-2 mb-3 no-print" role="search" aria-label="Filter questions">
    <div class="col-6 col-md-3"><select class="form-select form-select-sm" id="fLevel" aria-label="Difficulty"><option value="">All difficulties</option>${LEVELS.map(l => `<option>${l}</option>`).join('')}</select></div>
    <div class="col-6 col-md-3"><select class="form-select form-select-sm" id="fStatus" aria-label="Status"><option value="">Any status</option><option value="new">New</option><option value="reviewed">Reviewed</option><option value="bookmarked">Bookmarked</option></select></div>
    <div class="col-6 col-md-3"><select class="form-select form-select-sm" id="fTag" aria-label="Tag"><option value="">All tags</option>${tags.map(g => `<option>${esc(g)}</option>`).join('')}</select></div>
    <div class="col-6 col-md-3 d-flex align-items-center small text-body-secondary" id="fCount"></div></div>
  <div class="accordion" id="qAcc">${qs.map((q, i) => qItem(t, q, i)).join('')}</div>
  <div id="noMatch" class="text-center py-5 d-none"><i class="bi bi-funnel display-5 text-body-secondary"></i><p class="mt-2 mb-0">No questions match these filters.</p><button class="btn btn-link" data-act="clearFilters">Clear filters</button></div>
  <section class="card mt-5" id="cheat"><div class="card-header fw-bold"><i class="bi bi-card-checklist me-1"></i> One-page cheat sheet — ${esc(t.title)}</div><div class="card-body prose" id="cheatBody"></div></section>
  ${prevNext(idx)}`;
  $('#cheatBody').innerHTML = md(d.cheat || d.cheatsheet || '_Cheat sheet coming soon._', 'cs');
  enhance($('#cheatBody'));
  const f = state.filters; $('#fLevel').value = f.level; $('#fStatus').value = f.status; $('#fTag').value = f.tag; applyFilters();
  if (state.qid) openQuestion(t, state.qid, true);
}
function prevNext(idx) {
  const p = TOPICS[idx - 1], n = TOPICS[idx + 1];
  // the last topic leads to the interview-day checklist, which closes the site
  const next = n ? `<a class="btn btn-outline-secondary" href="#/${n.slug}">${esc(n.title)} <i class="bi bi-arrow-right"></i></a>`
    : `<a class="btn btn-brand" href="#/checklist">Interview-day checklist <i class="bi bi-check2-square"></i></a>`;
  return `<nav class="d-flex justify-content-between mt-4 no-print" aria-label="Topic navigation">${p ? `<a class="btn btn-outline-secondary" href="#/${p.slug}"><i class="bi bi-arrow-left"></i> ${esc(p.title)}</a>` : '<span></span>'}${next}</nav>`;
}
function qState(t, q) {
  return `${isBm(t.slug, q.id) ? '<i class="bi bi-bookmark-star-fill text-warning" title="Bookmarked"></i>' : ''}${isRev(t.slug, q.id) ? '<i class="bi bi-check-circle-fill text-success" title="Reviewed"></i>' : ''}`;
}
function qItem(t, q, i) {
  const id = t.slug + '-' + q.id, lvl = q.level || 'Intermediate';
  return `<div class="accordion-item q-item" id="item-${q.id}" data-q="${q.id}" data-level="${esc(lvl)}" data-tags="${esc((q.tags || []).join('|'))}">
    <h2 class="accordion-header"><button class="accordion-button collapsed" type="button" data-bs-toggle="collapse" data-bs-target="#c-${id}" aria-expanded="false" aria-controls="c-${id}">
      <span class="q-num">${i + 1}</span><span class="q-title">${esc(q.q)}</span>
      <span class="q-state d-flex gap-1" data-state="${q.id}">${qState(t, q)}</span>
      <span class="badge lvl lvl-${esc(lvl)} d-none d-sm-inline">${esc(lvl)}</span><span class="q-meta d-none d-md-inline">${readMins(q)} min</span></button></h2>
    <div id="c-${id}" class="accordion-collapse collapse" data-q="${q.id}"><div class="accordion-body q-body"></div></div></div>`;
}
function qBody(t, q) {
  const id = t.slug + '-' + q.id, pf = 'q' + q.id;
  const ans = md(q.a, pf), heads = md.heads || [];
  // long answers get a table of contents: the answer's own ### headings, else the standard sections
  let tocItems = heads.map(([h, x]) => [h, inline(x)]);
  if (tocItems.length < 3 && readMins(q) >= 2) {
    tocItems = [['pts-' + id, '30-second answer'], ['ans-' + id, 'Detailed answer']];
    if (q.dia || /~~~mermaid/.test(q.a || '')) tocItems.push(['dia-' + id, 'Diagram']);
    if (q.code) tocItems.push(['code-' + id, 'Code']);
    
    if (q.trade) tocItems.push(['trd-' + id, 'Trade-off']);
    if ((q.pit || []).length) tocItems.push(['pit-' + id, 'Pitfalls']);
    if (q.tip) tocItems.push(['tip-' + id, 'Interview tip']);
  }
  const toc = tocItems.length >= 3 ? `<nav class="toc no-print" aria-label="On this page"><strong class="me-2">On this page:</strong>${tocItems.map(([h, x]) => `<a href="#" data-jump="${h}">${x}</a>`).join('')}</nav>` : '';
  const dia = q.dia ? diagramBlock(q.dia) : '';
  const rel = (q.rel || t.loaded.related || t.related || []).map(s => BY_SLUG[s]).filter(Boolean).slice(0, 4);
  return `<div class="d-flex flex-wrap align-items-center gap-3 mb-3 q-tools">
      <div class="form-check mb-0"><input class="form-check-input" type="checkbox" id="rv-${id}" data-act="review" ${isRev(t.slug, q.id) ? 'checked' : ''}><label class="form-check-label ms-1" for="rv-${id}">Mark as reviewed</label></div>
      <button type="button" class="btn btn-sm btn-outline-secondary" data-act="bookmark" aria-pressed="${isBm(t.slug, q.id)}"><i class="bi ${isBm(t.slug, q.id) ? 'bi-bookmark-star-fill text-warning' : 'bi-bookmark-star'}"></i> Revise later</button>
      <button type="button" class="btn btn-sm btn-outline-secondary" data-act="link"><i class="bi bi-link-45deg"></i> Copy link</button>
      <span class="badge lvl lvl-${esc(q.level || 'Intermediate')} d-sm-none">${esc(q.level || 'Intermediate')}</span></div>
    ${toc}
    <ul class="nav nav-tabs" role="tablist" aria-label="Answer sections">
      <li class="nav-item" role="presentation"><button class="nav-link active" id="ta-${id}" data-bs-toggle="tab" data-bs-target="#a-${id}" type="button" role="tab" aria-controls="a-${id}" aria-selected="true"><i class="bi bi-chat-square-text me-1" aria-hidden="true"></i>Answer</button></li>
      <li class="nav-item" role="presentation"><button class="nav-link" id="te-${id}" data-bs-toggle="tab" data-bs-target="#e-${id}" type="button" role="tab" aria-controls="e-${id}" aria-selected="false"><i class="bi bi-globe2 me-1" aria-hidden="true"></i>Example</button></li>
      <li class="nav-item" role="presentation"><button class="nav-link" id="tf-${id}" data-bs-toggle="tab" data-bs-target="#f-${id}" type="button" role="tab" aria-controls="f-${id}" aria-selected="false"><i class="bi bi-question-circle me-1" aria-hidden="true"></i>Follow-ups</button></li></ul>
    <div class="tab-content pt-3">
      <div class="tab-pane fade show active" id="a-${id}" role="tabpanel" aria-labelledby="ta-${id}" tabindex="0" data-label="Answer">${(q.pts || []).length ? `<div class="card summary-card mb-3" id="pts-${id}"><div class="card-header fw-semibold"><i class="bi bi-stopwatch me-1" aria-hidden="true"></i>30-second answer <span class="fw-normal text-body-secondary small ms-1">say this first, then go deep</span></div><ol class="list-group list-group-flush list-group-numbered">${q.pts.map(p => `<li class="list-group-item">${inline(p)}</li>`).join('')}</ol></div>` : ''}<h5 class="ans-h"><i class="bi bi-layers me-1" aria-hidden="true"></i>Detailed answer</h5><div class="prose" id="ans-${id}">${ans}</div>
        ${dia}
        ${q.code ? `<div class="prose q-code" id="code-${id}"><h5><i class="bi bi-code-square me-1" aria-hidden="true"></i>Code example</h5>${md(q.code, pf + 'c')}</div>` : ''}
        ${q.trade ? `<div class="alert alert-warning callout callout-trade" id="trd-${id}" role="note"><strong><i class="bi bi-arrow-left-right"></i>Trade-off.</strong> ${inline(q.trade)}</div>` : ''}</div>
      <div class="tab-pane fade" id="e-${id}" role="tabpanel" aria-labelledby="te-${id}" tabindex="0" data-label="Example"><div class="alert alert-light border callout callout-real mb-3" role="note"><strong><i class="bi bi-globe2"></i>Real-world example</strong></div><div class="prose">${md(q.ex, pf + 'e') || '<p class="text-body-secondary">No example for this question.</p>'}</div></div>
      <div class="tab-pane fade" id="f-${id}" role="tabpanel" aria-labelledby="tf-${id}" tabindex="0" data-label="Follow-ups">${(q.fu || []).length ? '<ol class="prose">' + q.fu.map(x => `<li>${inline(x)}</li>`).join('') + '</ol>' : '<p class="text-body-secondary">None listed.</p>'}</div></div>
    ${(q.pit || []).length ? `<div class="alert alert-danger callout mt-3" id="pit-${id}" role="note"><strong><i class="bi bi-exclamation-triangle"></i>Pitfalls</strong><ul class="mb-0 mt-1">${q.pit.map(x => `<li>${inline(x)}</li>`).join('')}</ul></div>` : ''}
    ${q.tip ? `<div class="alert alert-info callout" id="tip-${id}" role="note"><strong><i class="bi bi-lightbulb"></i>Interview tip.</strong> ${inline(q.tip)}</div>` : ''}
    ${rel.length ? `<div class="mt-3 small no-print"><span class="text-body-secondary me-1">Related topics:</span>${rel.map(r => `<a class="chip me-1" style="--cat:${CAT[r.cat].color}" href="#/${r.slug}">${esc(r.title)}</a>`).join('')}</div>` : ''}`;
}
function fillBody(t, item) {
  const body = $('.q-body', item); if (body.dataset.ready) return;
  const q = t.loaded.questions.find(x => x.id === item.dataset.q); body.innerHTML = qBody(t, q); body.dataset.ready = 1;
  const fig = $('.diagram', body); if (fig) fig.id = 'dia-' + t.slug + '-' + q.id; // TOC anchor
  enhance(body);
}
function openQuestion(t, qid, scroll) {
  const item = document.getElementById('item-' + qid); if (!item) return;
  item.classList.remove('d-none'); fillBody(t, item);
  bootstrap.Collapse.getOrCreateInstance($('.accordion-collapse', item), { toggle: false }).show();
  state.cursor = visibleItems().indexOf(item); markCursor();
  if (scroll) setTimeout(() => item.scrollIntoView({ block: 'start', behavior: reduceMotion ? 'auto' : 'smooth' }), 120);
}
const visibleItems = () => $$('.q-item').filter(i => !i.classList.contains('d-none'));
function markCursor() { $$('.q-item.cursor').forEach(i => i.classList.remove('cursor')); const it = visibleItems()[state.cursor]; if (it) it.classList.add('cursor'); return it; }
function applyFilters() {
  const t = BY_SLUG[state.slug]; if (!t || !t.loaded) return; const f = state.filters; let n = 0;
  $$('.q-item').forEach(it => {
    const id = it.dataset.q; let ok = true;
    if (f.level && it.dataset.level !== f.level) ok = false;
    if (f.tag && !it.dataset.tags.split('|').includes(f.tag)) ok = false;
    if (f.status === 'new' && isRev(t.slug, id)) ok = false;
    if (f.status === 'reviewed' && !isRev(t.slug, id)) ok = false;
    if (f.status === 'bookmarked' && !isBm(t.slug, id)) ok = false;
    it.classList.toggle('d-none', !ok); if (ok) n++;
  });
  $('#fCount').textContent = `Showing ${n} of ${t.loaded.questions.length}`; $('#noMatch').classList.toggle('d-none', n > 0);
}
function refreshProgress(t) {
  const rv = topicRevCount(t.slug), n = t.loaded.questions.length, p = pct(rv, n), bar = $('#tpBar');
  if (bar) { bar.setAttribute('aria-valuenow', p); $('.progress-bar', bar).style.width = p + '%'; $('#tpText').textContent = `${rv} / ${n} reviewed`; }
  $$('.sb-item[data-slug="' + t.slug + '"] .prog i').forEach(i => i.style.width = pct(rv, t.count) + '%');
}
function refreshState(t, id) { const el = $(`[data-state="${id}"]`); if (el) el.innerHTML = qState(t, t.loaded.questions.find(q => q.id === id)); }
function toggleReview(t, id, on, quiet) {
  const k = kq(t.slug, id); if (on) S.rev[k] = 1; else delete S.rev[k]; save(); refreshState(t, id); refreshProgress(t);
  const done = topicRevCount(t.slug) >= t.loaded.questions.length;
  if (on && done && !S.seen[t.slug]) { S.seen[t.slug] = 1; save(); confetti(); toast('🎉 ' + t.title + ' complete — all questions reviewed!'); }
  else if (!on) delete S.seen[t.slug];
  if (!quiet) applyFilters();
}
function toggleBookmark(t, id) {
  const k = kq(t.slug, id), on = !S.bm[k]; if (on) S.bm[k] = 1; else delete S.bm[k]; save(); refreshState(t, id);
  const btn = $(`#item-${id} [data-act="bookmark"]`); if (btn) { btn.setAttribute('aria-pressed', on); btn.innerHTML = `<i class="bi ${on ? 'bi-bookmark-star-fill text-warning' : 'bi-bookmark-star'}"></i> Revise later`; }
  toast(on ? 'Bookmarked for revision' : 'Bookmark removed');
}

/* ---------- code, diagrams ---------- */
function enhance(root) {
  if (window.hljs) $$('pre code', root).forEach(c => { if (!c.dataset.hl) { try { hljs.highlightElement(c); } catch { /* unknown language: leave plain */ } c.dataset.hl = 1; } });
  $$('.diagram', root).forEach(d => diagObserver.observe(d));
}
const diagObserver = new IntersectionObserver(es => es.forEach(e => { if (e.isIntersecting && !e.target.dataset.done) renderDiagram(e.target); }), { rootMargin: '200px' });
let mermaidP = null, mermaidTheme = null, dgUid = 0;
function loadMermaid() {
  if (window.mermaid) return Promise.resolve();
  return mermaidP || (mermaidP = new Promise((res, rej) => {
    const s = document.createElement('script'); s.src = 'https://cdn.jsdelivr.net/npm/mermaid@11.4.1/dist/mermaid.min.js';
    s.onload = res; s.onerror = () => { mermaidP = null; rej(new Error('Mermaid failed to load')); }; document.head.appendChild(s);
  }));
}
async function renderDiagram(fig) {
  const box = $('.dg-canvas', fig);
  if (fig.dataset.busy) return; fig.dataset.busy = 1;
  try {
    await loadMermaid();
    const th = curTheme() === 'dark' ? 'dark' : 'neutral';
    if (mermaidTheme !== th) { mermaid.initialize({ startOnLoad: false, theme: th, securityLevel: 'strict', htmlLabels: false, flowchart: { htmlLabels: false }, fontFamily: 'Inter, Segoe UI, sans-serif' }); mermaidTheme = th; }
    const { svg } = await mermaid.render('mmd' + (++dgUid), fig.dataset.code);
    box.innerHTML = svg; box.classList.remove('placeholder-glow'); fig.dataset.done = curTheme();
  } catch (err) {
    box.innerHTML = `<div class="text-danger small"><i class="bi bi-exclamation-circle"></i> Diagram unavailable (${esc(err.message || 'render error')}). <button class="btn btn-link btn-sm" data-act="retryDiagram">Retry</button></div>`;
  } finally { delete fig.dataset.busy; }
}
const renderPending = root => $$('.diagram', root).forEach(f => { if (!f.dataset.done) renderDiagram(f); });
function rerenderDiagrams() { $$('.diagram').forEach(f => { if (f.dataset.done) { delete f.dataset.done; renderDiagram(f); } }); }
// full-screen pan / zoom viewer
const dg = { k: 1, x: 0, y: 0 };
function dgApply() { $('#dgStage').style.transform = `translate(${dg.x}px,${dg.y}px) scale(${dg.k})`; }
function dgFit() { const s = $('#dgStage'), b = $('#dgBody'), svg = $('svg', s); if (!svg) return; const w = svg.viewBox?.baseVal?.width || svg.getBoundingClientRect().width || 800, h = svg.viewBox?.baseVal?.height || svg.getBoundingClientRect().height || 600;
  svg.setAttribute('width', w); svg.setAttribute('height', h); dg.k = Math.min(b.clientWidth / w, b.clientHeight / h, 2) * .95; dg.x = (b.clientWidth - w * dg.k) / 2; dg.y = (b.clientHeight - h * dg.k) / 2; dgApply(); }
function openDiagram(fig) {
  const svg = $('svg', fig); if (!svg) return; const m = bootstrap.Modal.getOrCreateInstance($('#dgModal')); $('#dgStage').innerHTML = svg.outerHTML; m.show();
}
function dgBlob() { const svg = $('#dgStage svg'); const s = new XMLSerializer().serializeToString(svg); return s.includes('xmlns=') ? s : s.replace('<svg', '<svg xmlns="http://www.w3.org/2000/svg"'); }
function download(name, blob) { const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000); }
function bindDiagramViewer() {
  $('#dgModal').addEventListener('shown.bs.modal', dgFit);
  $('#dgIn').onclick = () => { dg.k *= 1.25; dgApply(); }; $('#dgOut').onclick = () => { dg.k /= 1.25; dgApply(); }; $('#dgReset').onclick = dgFit;
  $('#dgSvg').onclick = () => download('diagram.svg', new Blob([dgBlob()], { type: 'image/svg+xml' }));
  $('#dgPng').onclick = () => {
    const svg = $('#dgStage svg'), w = +svg.getAttribute('width') || 1200, h = +svg.getAttribute('height') || 800, img = new Image();
    img.onload = () => { const c = document.createElement('canvas'); c.width = w * 2; c.height = h * 2; const x = c.getContext('2d'); x.fillStyle = curTheme() === 'dark' ? '#212529' : '#fff'; x.fillRect(0, 0, c.width, c.height); x.drawImage(img, 0, 0, c.width, c.height); c.toBlob(b => download('diagram.png', b)); };
    img.onerror = () => toast('PNG export is not supported for this diagram; use SVG'); img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(dgBlob());
  };
  const body = $('#dgBody'); let drag = null;
  body.addEventListener('wheel', e => { e.preventDefault(); const f = e.deltaY < 0 ? 1.1 : 1 / 1.1, r = body.getBoundingClientRect(), px = e.clientX - r.left, py = e.clientY - r.top; dg.x = px - (px - dg.x) * f; dg.y = py - (py - dg.y) * f; dg.k *= f; dgApply(); }, { passive: false });
  body.addEventListener('pointerdown', e => { drag = { x: e.clientX - dg.x, y: e.clientY - dg.y }; body.classList.add('dragging'); body.setPointerCapture(e.pointerId); });
  body.addEventListener('pointermove', e => { if (drag) { dg.x = e.clientX - drag.x; dg.y = e.clientY - drag.y; dgApply(); } });
  body.addEventListener('pointerup', () => { drag = null; body.classList.remove('dragging'); });
}

/* ---------- bookmarks / checklist ---------- */
async function renderBookmarks(view) {
  view.innerHTML = `<h1 class="h2"><i class="bi bi-bookmark-star-fill text-warning"></i> Bookmarks</h1><div class="placeholder-glow"><span class="placeholder col-12"></span></div>`;
  await loadAllReady();
  const items = Object.keys(S.bm).map(k => { const [slug, id] = k.split('/'), t = BY_SLUG[slug], q = t && t.loaded && t.loaded.questions.find(x => x.id === id); return q ? { t, q } : null; }).filter(Boolean);
  view.innerHTML = `<h1 class="h2"><i class="bi bi-bookmark-star-fill text-warning"></i> Bookmarks <small class="fs-6 text-body-secondary">${items.length} to revise</small></h1>` +
    (items.length ? `<div class="list-group mt-3">${items.map(({ t, q }) => `<div class="list-group-item d-flex gap-3 align-items-center"><a class="flex-grow-1 text-decoration-none" href="#/${t.slug}/${q.id}"><div class="fw-semibold">${esc(q.q)}</div><div class="small text-body-secondary">${esc(t.title)} · ${esc(q.level || '')}</div></a><button class="btn btn-sm btn-outline-secondary" data-rm="${t.slug}/${q.id}" aria-label="Remove bookmark"><i class="bi bi-x-lg"></i></button></div>`).join('')}</div>` :
      `<div class="text-center py-5"><i class="bi bi-bookmark display-4 text-body-secondary"></i><p class="mt-3">Nothing bookmarked yet. Press <kbd>b</kbd> on a question or use “Revise later”.</p></div>`);
}
function renderChecklist(view) {
  const L = window.SITE_CHECKLIST;
  view.innerHTML = `<h1 class="h2"><i class="bi bi-check2-square"></i> Interview-day checklist</h1><p class="text-body-secondary">Ticks are saved in this browser.</p>` +
    L.map((g, gi) => `<div class="card mb-3"><div class="card-header fw-semibold"><i class="bi ${g.icon} me-1"></i>${esc(g.title)}</div><ul class="list-group list-group-flush">${g.items.map((it, i) => { const k = gi + '.' + i; return `<li class="list-group-item"><div class="form-check"><input class="form-check-input" type="checkbox" id="ck${k}" data-ck="${k}" ${S.chk[k] ? 'checked' : ''}><label class="form-check-label ms-1" for="ck${k}">${esc(it)}</label></div></li>`; }).join('')}</ul></div>`).join('');
}

/* ---------- flashcards / mock interview ---------- */
let deck = null, tick = null;
async function renderFlash(view, which) {
  clearInterval(tick);
  if (!allReady().length) { view.innerHTML = `<h1 class="h2">Mock interview</h1><div class="alert alert-secondary">No topics are written yet.</div>`; return; }
  view.innerHTML = `<h1 class="h2">Mock interview</h1><div class="placeholder-glow"><span class="placeholder col-12"></span></div>`;
  const ts = which === 'all' ? allReady() : [BY_SLUG[which]].filter(Boolean);
  if (!ts.length || ts.some(t => !READY.has(t.slug))) { view.innerHTML = `<h1 class="h2">Mock interview</h1><div class="alert alert-secondary">That topic is not written yet.</div>`; return; }
  await Promise.allSettled(ts.map(loadTopic));
  const cards = ts.filter(t => t.loaded).flatMap(t => t.loaded.questions.map(q => ({ t, q })));
  for (let i = cards.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [cards[i], cards[j]] = [cards[j], cards[i]]; }
  deck = { cards: cards.slice(0, which === 'all' ? 10 : 50), i: 0, res: { got: 0, partly: 0, missed: 0 }, which }; flashCard(view);
}
function flashCard(view) {
  clearInterval(tick);
  const d = deck;
  if (d.i >= d.cards.length) {
    view.innerHTML = `<h1 class="h2">Session complete</h1><div class="row g-3 my-3">${[['got', 'Got it', 'success'], ['partly', 'Partly', 'warning'], ['missed', 'Missed', 'danger']].map(([k, l, c]) => `<div class="col-4"><div class="card text-center border-${c}"><div class="card-body"><div class="display-6">${d.res[k]}</div>${l}</div></div></div>`).join('')}</div>
      <p class="text-body-secondary">“Partly” and “missed” cards were added to your bookmarks.</p><a class="btn btn-brand" href="#/flash/${d.which}" onclick="location.reload()">New session</a> <a class="btn btn-outline-secondary" href="#/bookmarks">Open bookmarks</a>`; return;
  }
  const { t, q } = d.cards[d.i]; let secs = 0, revealed = false;
  view.innerHTML = `<nav class="d-flex justify-content-between align-items-center mb-3"><h1 class="h4 mb-0"><i class="bi bi-stopwatch"></i> Mock interview <small class="text-body-secondary">${d.i + 1} / ${d.cards.length}</small></h1><a class="btn btn-sm btn-outline-secondary" href="#/">Exit</a></nav>
    <div class="progress mb-3" style="height:.4rem" role="progressbar" aria-label="Session progress"><div class="progress-bar" style="width:${pct(d.i, d.cards.length)}%"></div></div>
    <div class="card flash-card"><div class="card-header d-flex justify-content-between"><span><span class="badge lvl lvl-${esc(q.level || 'Intermediate')}">${esc(q.level || '')}</span> <span class="text-body-secondary small ms-1">${esc(t.title)}</span></span><span class="timer" id="fTimer" aria-label="Elapsed time">00:00</span></div>
      <div class="card-body"><h2 class="h4">${esc(q.q)}</h2><p class="text-body-secondary">Answer out loud first, as you would in the interview. Then reveal.</p><div id="fAns" class="prose mt-3"></div></div>
      <div class="card-footer d-flex flex-wrap gap-2 justify-content-center" id="fBtns"><button class="btn btn-brand" id="reveal"><i class="bi bi-eye"></i> Reveal answer <kbd class="ms-1">Space</kbd></button></div></div>`;
  tick = setInterval(() => { secs++; const el = $('#fTimer'); if (el) el.textContent = String(Math.floor(secs / 60)).padStart(2, '0') + ':' + String(secs % 60).padStart(2, '0'); }, 1000);
  const rate = r => { d.res[r]++; if (r !== 'got') { S.bm[kq(t.slug, q.id)] = 1; } S.rate[kq(t.slug, q.id)] = r; save(); d.i++; flashCard(view); };
  const reveal = () => {
    if (revealed) return; revealed = true; clearInterval(tick);
    const ans = $('#fAns'); ans.innerHTML = md(q.a, 'fl') + (q.code ? '<h5>Code example</h5>' + md(q.code, 'flc') : '') + ((q.pts || []).length ? '<h5>Key points</h5><ul>' + q.pts.map(p => `<li>${inline(p)}</li>`).join('') + '</ul>' : ''); enhance(ans);
    $('#fBtns').innerHTML = `<button class="btn btn-success" data-r="got">Got it <kbd>1</kbd></button><button class="btn btn-warning" data-r="partly">Partly <kbd>2</kbd></button><button class="btn btn-danger" data-r="missed">Missed <kbd>3</kbd></button>`;
    $$('#fBtns [data-r]').forEach(b => b.onclick = () => rate(b.dataset.r));
  };
  $('#reveal').onclick = reveal; deck.keys = e => { if (e.key === ' ' && !revealed) { e.preventDefault(); reveal(); } else if (revealed && '123'.includes(e.key)) rate(['got', 'partly', 'missed'][+e.key - 1]); };
  $('#reveal').focus();
}

/* ---------- command palette ---------- */
let palSel = 0, palRes = [];
async function openPalette(initial = '') {
  const m = bootstrap.Modal.getOrCreateInstance($('#palette')); m.show(); const inp = $('#palInput'); inp.value = initial;
  $('#palResults').innerHTML = `<div class="p-4 text-body-secondary">Indexing topics…</div>`; await loadAllReady(); runPalette();
  setTimeout(() => inp.focus(), 200);
}
function hl(text, terms) { let h = esc(text); for (const t of terms) { if (t.length < 2) continue; h = h.replace(new RegExp('(' + t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ')(?![^<]*>)', 'ig'), '<mark>$1</mark>'); } return h; }
function runPalette() {
  const raw = $('#palInput').value.trim(), terms = raw.toLowerCase().split(/\s+/).filter(Boolean); palRes = [];
  if (!terms.length) { $('#palResults').innerHTML = `<div class="p-4 text-body-secondary">Type to search ${READY.size} written topics. Try “saga”, “idempotency”, “deadlock”.</div>`; return; }
  for (const t of TOPICS) {
    if (terms.every(x => (t.title + ' ' + t.n).toLowerCase().includes(x))) palRes.push({ score: 50, href: '#/' + t.slug, title: t.title, sub: 'Topic · ' + CAT[t.cat].name, snip: '' });
    if (!t.loaded) continue;
    for (const q of t.loaded.questions) {
      const title = q.q.toLowerCase(), body = plain([q.a, (q.pts || []).join(' '), (q.tags || []).join(' ')].join(' ')).toLowerCase();
      if (!terms.every(x => title.includes(x) || body.includes(x))) continue;
      const sc = terms.reduce((a, x) => a + (title.includes(x) ? 10 : 0) + (body.includes(x) ? 1 : 0), 0);
      const pos = body.indexOf(terms.find(x => body.includes(x)) || ''), snip = pos >= 0 ? plain([q.a, (q.pts || []).join(' ')].join(' ')).replace(/\s+/g, ' ').slice(Math.max(0, pos - 40), pos + 110) : '';
      palRes.push({ score: sc, href: `#/${t.slug}/${q.id}`, title: q.q, sub: t.title + ' · ' + (q.level || ''), snip });
    }
  }
  palRes.sort((a, b) => b.score - a.score); palRes = palRes.slice(0, 40); palSel = 0;
  $('#palResults').innerHTML = palRes.length ? palRes.map((r, i) => `<a class="pal-item ${i ? '' : 'sel'}" href="${r.href}" role="option" data-i="${i}"><div class="fw-semibold">${hl(r.title, terms)}</div><div class="small text-body-secondary">${esc(r.sub)}</div>${r.snip ? `<div class="small">…${hl(r.snip, terms)}…</div>` : ''}</a>`).join('')
    : `<div class="p-5 text-center text-body-secondary"><i class="bi bi-search display-5"></i><p class="mt-3 mb-0">No results for “${esc(raw)}”.</p><p class="small">Try a shorter or different term.</p></div>`;
}
function palMove(d) { const els = $$('.pal-item'); if (!els.length) return; els[palSel]?.classList.remove('sel'); palSel = (palSel + d + els.length) % els.length; els[palSel].classList.add('sel'); els[palSel].scrollIntoView({ block: 'nearest' }); }

/* ---------- events ---------- */
function bind() {
  $('#themeBtn').onclick = () => applyTheme(curTheme() === 'dark' ? 'light' : 'dark', true);
  $('#sbToggle').onclick = () => { S.side = !S.side; save(); document.body.classList.toggle('side-collapsed', S.side); $('#sbToggle').setAttribute('aria-pressed', S.side); };
  const ns = $('#navSearch'); ns.addEventListener('focus', () => { ns.blur(); openPalette(); });
  $('#palInput').addEventListener('input', runPalette);
  $('#palInput').addEventListener('keydown', e => {
    if (e.key === 'ArrowDown') { e.preventDefault(); palMove(1); } else if (e.key === 'ArrowUp') { e.preventDefault(); palMove(-1); }
    else if (e.key === 'Enter') { const r = palRes[palSel]; if (r) { bootstrap.Modal.getInstance($('#palette')).hide(); location.hash = r.href; } }
  });
  $('#palResults').addEventListener('click', () => bootstrap.Modal.getInstance($('#palette'))?.hide());
  $('#mKeys').onclick = () => bootstrap.Modal.getOrCreateInstance($('#keysModal')).show();
  $('#mPrint').onclick = () => printAll().then(() => window.print());
  $('#mExport').onclick = () => download('interview-prep-progress.json', new Blob([JSON.stringify({ app: 'iq', version: 1, exported: new Date().toISOString(), state: S }, null, 2)], { type: 'application/json' }));
  $('#mImport').onclick = () => $('#importFile').click();
  $('#importFile').onchange = async e => {
    try { const j = JSON.parse(await e.target.files[0].text()); if (j.app !== 'iq' || !j.state) throw new Error('Not a progress file'); S = Object.assign(defaults(), j.state); save(); toast('Progress imported'); route(); }
    catch (err) { toast('Import failed: ' + err.message); } e.target.value = '';
  };
  $('#mReset').onclick = () => { if (confirm('Reset all progress, bookmarks and checklist ticks in this browser?')) { S = Object.assign(defaults(), { theme: S.theme }); save(); route(); toast('Progress reset'); } };
  $('#toTop').onclick = () => window.scrollTo({ top: 0, behavior: reduceMotion ? 'auto' : 'smooth' });
  addEventListener('scroll', () => $('#toTop').classList.toggle('show', scrollY > 600), { passive: true });
  addEventListener('hashchange', route);

  const view = $('#view');
  view.addEventListener('click', e => {
    const a = e.target.closest('[data-act],[data-jump],[data-rm]'); if (!a) { const cv = e.target.closest('.dg-canvas'); if (cv && $('svg', cv)) openDiagram(cv.closest('.diagram')); return; }
    const t = BY_SLUG[state.slug], item = a.closest('.q-item'), qid = item && item.dataset.q, act = a.dataset.act;
    if (a.dataset.jump) { e.preventDefault(); document.getElementById(a.dataset.jump)?.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth' }); }
    else if (a.dataset.rm) { delete S.bm[a.dataset.rm]; save(); renderBookmarks(view); }
    else if (act === 'copy') { const code = $('code', a.closest('.codeblock')).textContent; (navigator.clipboard ? navigator.clipboard.writeText(code) : Promise.reject()).then(() => { a.innerHTML = '<i class="bi bi-check2"></i> Copied'; setTimeout(() => a.innerHTML = '<i class="bi bi-clipboard"></i> Copy', 1600); }).catch(() => toast('Copy failed: select the code and press Ctrl+C')); }
    else if (act === 'zoom') openDiagram(a.closest('.diagram'));
    else if (act === 'retryDiagram') renderDiagram(a.closest('.diagram'));
    else if (act === 'bookmark') toggleBookmark(t, qid);
    else if (act === 'link') { const u = location.href.split('#')[0] + '#/' + t.slug + '/' + qid; (navigator.clipboard ? navigator.clipboard.writeText(u) : Promise.reject()).then(() => toast('Link copied')).catch(() => toast(u)); }
    else if (act === 'expand') { $$('.q-item:not(.d-none)').forEach(i => { fillBody(t, i); bootstrap.Collapse.getOrCreateInstance($('.accordion-collapse', i), { toggle: false }).show(); }); }
    else if (act === 'collapse') $$('.accordion-collapse.show').forEach(c => bootstrap.Collapse.getOrCreateInstance(c, { toggle: false }).hide());
    else if (act === 'print') printAll().then(() => window.print());
    else if (act === 'clearFilters') { state.filters = { level: '', status: '', tag: '' }; ['fLevel', 'fStatus', 'fTag'].forEach(i => $('#' + i).value = ''); applyFilters(); }
  });
  view.addEventListener('change', e => {
    const t = BY_SLUG[state.slug];
    if (e.target.dataset.act === 'review') toggleReview(t, e.target.closest('.q-item').dataset.q, e.target.checked);
    else if (e.target.dataset.ck) { S.chk[e.target.dataset.ck] = e.target.checked ? 1 : 0; save(); }
    else if (['fLevel', 'fStatus', 'fTag'].includes(e.target.id)) { state.filters = { level: $('#fLevel').value, status: $('#fStatus').value, tag: $('#fTag').value }; applyFilters(); }
  });
  view.addEventListener('show.bs.collapse', e => { const t = BY_SLUG[state.slug], it = e.target.closest('.q-item'); if (t && it) fillBody(t, it); });
  view.addEventListener('shown.bs.tab', e => renderPending($(e.target.dataset.bsTarget)));
  view.addEventListener('shown.bs.collapse', e => { const it = e.target.closest('.q-item'); if (it) renderPending(it); if (it && state.slug) { history.replaceState(null, '', '#/' + state.slug + '/' + it.dataset.q); S.last = { slug: state.slug, q: it.dataset.q }; save(); } });

  addEventListener('keydown', onKey);
  addEventListener('beforeprint', printAll);
}
// print/PDF: render every answer and every diagram (off-screen diagrams are otherwise lazy)
function printAll() { const t = BY_SLUG[state.slug]; if (!t || !t.loaded) return Promise.resolve(); $$('.q-item').forEach(i => fillBody(t, i)); return Promise.allSettled($$('.diagram').filter(f => !f.dataset.done).map(renderDiagram)); }
function onKey(e) {
  const tag = (e.target.tagName || '').toLowerCase(), typing = ['input', 'textarea', 'select'].includes(tag) || e.target.isContentEditable;
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); openPalette(); return; }
  if (deck && /^#\/flash/.test(location.hash) && deck.keys && !typing) { deck.keys(e); return; }
  if (typing || e.ctrlKey || e.metaKey || e.altKey) return;
  const t = BY_SLUG[state.slug], items = visibleItems();
  switch (e.key) {
    case '/': e.preventDefault(); openPalette(); break;
    case 't': applyTheme(curTheme() === 'dark' ? 'light' : 'dark', true); break;
    case '?': bootstrap.Modal.getOrCreateInstance($('#keysModal')).show(); break;
    case 'j': case 'k': if (!items.length) return; state.cursor = Math.max(0, Math.min(items.length - 1, state.cursor + (e.key === 'j' ? 1 : -1))); { const it = markCursor(); it.scrollIntoView({ block: 'center', behavior: reduceMotion ? 'auto' : 'smooth' }); $('.accordion-button', it).focus({ preventScroll: true }); } break;
    case 'e': { const it = items[state.cursor]; if (it) { fillBody(t, it); bootstrap.Collapse.getOrCreateInstance($('.accordion-collapse', it), { toggle: false }).toggle(); } break; }
    case 'b': { const it = items[state.cursor]; if (it && t) toggleBookmark(t, it.dataset.q); break; }
    case 'r': { const it = items[state.cursor]; if (it && t) { const on = !isRev(t.slug, it.dataset.q); toggleReview(t, it.dataset.q, on); const cb = $('[data-act="review"]', it); if (cb) cb.checked = on; } break; }
  }
}

/* ---------- boot ---------- */
function boot() {
  $('#updated').textContent = window.SITE_UPDATED || '';
  document.body.classList.toggle('side-collapsed', !!S.side); $('#sbToggle').setAttribute('aria-pressed', !!S.side);
  bindSidebar(); bind(); bindDiagramViewer();
  applyTheme(curTheme(), false);
  route();
  if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol)) navigator.serviceWorker.register('sw.js').catch(() => {});
}
boot();
})();
