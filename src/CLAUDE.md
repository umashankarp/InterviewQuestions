# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

Scope: the interview-prep **website** under `src/`. Study-program rules (module templates, domain map, Progress Log) live in the repo-root `../CLAUDE.md`; its §B entry dated 2026-10-10 is the origin of this site.

## Hard rules
- **Everything for the site lives inside `src/`.** Never write site files into the repo's domain folders (`../01-CSharp/` etc.) and never modify `../14-System-Design/` (standing user constraint). Topic data goes in `src/<NN-Folder>/questions.js`. (`src/14-System-Design/questions.js` is the site's own data file and may be edited; the protected folder is the repo-level `../14-System-Design/`.)
- Source material for each topic is the consolidated study file `../<NN-Folder>/01-*-Interview-Prep.md` (read-only; `grep -n "^## "` gives its outline).
- No build step, no npm dependencies for the site itself. Only CDN libraries: Bootstrap 5.3.3, Bootstrap Icons, highlight.js 11.9.0 (C#, SQL, TypeScript, YAML, Dockerfile, PowerShell grammars added in `index.html`), Mermaid **pinned to 11.4.1** (lazy-loaded in `app.js`).
- Write one topic at a time and register it only after it passes validation (below).

## Running
Open `index.html` directly (topic files load via `<script>` tags, so `file://` works), or serve the folder with any static server to exercise the service worker, which only runs on http(s)/localhost.

## Architecture
- `assets/topics.js` — the registry. `SITE_CATS` (9 sidebar categories), `SITE_TOPICS` built from a `[num, folder, title, cat, icon, relatedNums]` table (slug = lower-cased folder, data path = `<folder>/questions.js`), `SITE_READY` (slugs whose data files exist; others render a "being written" state), `SITE_UPDATED` (also the `?v=` cache-buster on topic scripts — bump it when an already-published `questions.js` changes, or browsers/the SW may serve the stale copy).
- `assets/app.js` — the whole app, no framework:
  - **Loading:** `loadTopic` injects `<folder>/questions.js`, which calls the global `registerTopic(slug, data)`. A file that loads but doesn't register produces the error/retry state.
  - **Routing:** hash routes: `#/` (dashboard), `#/<slug>[/<qid>]`, `#/bookmarks`, `#/checklist`, `#/flash/<which>`.
  - **State:** a single localStorage object under key `iq.v1` (theme, last topic, expanded categories, reviewed, bookmarks, flashcard ratings, checklist). Every access is wrapped in try/catch.
  - **Rendering:** a small markdown renderer `md()` plus `inline()`. Code fences are extracted *before* inline parsing, so `{{…}}` inside a fence stays literal.
  - **Diagrams:** Mermaid renders on intersection, re-renders on theme change (`neutral`/`dark`), and has a zoom/download viewer.
- `assets/checklist.js` — `SITE_CHECKLIST`, the interview-day checklist.
- `sw.js` — precaches the shell, then stale-while-revalidate for everything else. **Bump `VERSION`** when shell files (`index.html`, `assets/*`) change.

## Topic data file format
Each file is wrapped like this; a bare top-level `const` would collide across topic files in the browser:
```js
(function (r) {
registerTopic('21-aws', { related: [...slugs], questions: [ ... ], cheat: r`...` });
})(String.raw);
```
Per question: `id` (`q1`…`q50`, sequential), `level` (`Basic`|`Intermediate`|`Senior`|`Principal`), `tags`, `q`, `a`, `pts[]` (30-second answer), `ex` (real-world example), `fu[]` (follow-ups), `pit[]` (pitfalls); optional `code`, `dia` (raw Mermaid, no fence), `tip`, `trade`, `rel[]`.

Mini-markdown inside strings: `~~~lang` fences, `~~~mermaid`, `{{inline code}}`, `**bold**`, `###` headings, `-`/`1.` lists, `| tables |` (no `|` inside a cell).

Inside `String.raw` templates, write `$\{` for a literal `${` and `\x60` for a backtick; `unraw()` converts both at render time. An unescaped `${` breaks the file — this includes GitHub Actions `${{ }}` (write `$\{{ }}`).

Authoring pitfalls that have bitten before:
- Inline code ending in `}` (e.g. `{{new { a }}}`) produces `}}}` and mis-parses; reword so the span doesn't end in a brace. Grep each new file for `}}}`.
- Mermaid: no `;` inside sequence-diagram messages, no parentheses inside `[...]` labels, no empty node labels.
- Fixing escapes with `sed` can silently fail on CRLF content; use a targeted edit instead.

## Content bar (user requirements)
- 50 questions per topic, ascending: **6 Basic · 12 Intermediate · 18 Senior · 14 Principal**. Audience is Lead/Principal/Full-Stack (.NET + Angular/React); no junior recall questions. Basic questions probe mechanism, not definitions.
- Code example in **≥45 of 50** questions; Mermaid diagrams wherever the topic is architectural.
- Senior depth: trade-offs, failure modes, cost, security, team impact; financial-services scenarios where natural (payments, ledgers, trading), per root `CLAUDE.md` §A2.
- Every topic ends with a `cheat` one-pager.

## Validation (run before adding a slug to `SITE_READY`)
The checker scripts are **not in the repo**. They live in a Claude scratchpad that can be wiped — last known location `%TEMP%/claude/e--Interview-Questions-src/cd3d8e9a-9d47-4aff-bf04-5043dd2d861c/scratchpad/` (run `mm/check.mjs` from inside `mm/` so it finds its `node_modules`):
- `validate.js <file>`: evals the file with a stub `registerTopic`, then checks: exactly 50 questions, sequential ids, level order and counts, required fields present, no raw `${`, balanced `~~~` fences, a `cheat` sheet, and code coverage ≥45.
- `mm/check.mjs <file>`: parses every Mermaid block (`dia` plus `~~~mermaid` in `a`/`code`) with `mermaid.parse` under jsdom (`npm i jsdom mermaid@11.4.1`). Common failures: `;` inside sequence-diagram messages, and parentheses inside `[...]` node labels.
- `ready.sh <file>`: runs both, then rebuilds the `SITE_READY` line in `assets/topics.js` from the `[0-9][0-9]-*/questions.js` files that exist.

If these are gone, recreate them from the rules above before registering a topic.
