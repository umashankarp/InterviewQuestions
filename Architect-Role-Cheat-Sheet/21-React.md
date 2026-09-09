# 21. React — 20 Questions (Answered)

> **Method:** every definition is taken from the **official React documentation** (`react.dev` — Learn, the API Reference, and the *"You Might Not Need an Effect"* and *"Start a New React Project"* guides) and the **React blog** (the React 18 and 19 release posts, React Compiler, Server Components), supplemented by **MDN** for browser-platform mechanics and the **Next.js** / **React Router** docs where a framework concern is unavoidable. Then the architect-level analysis: what it costs, when it is the wrong choice, and how a customer-facing bank portal or a trading UI actually uses it. Angular comparisons are drawn against the sibling module **20**. Links in **References**.

---

## Q1. What is React, and why is calling it "just a library" significant architecturally?

**Per react.dev:** React is *"the library for web and native user interfaces"* — a library for building UIs out of **components**, using a **declarative** model where you describe what the UI should look like for a given state and React keeps the DOM in sync.

**"Library, not framework" is not pedantry — it dictates your architecture:**

| React gives you | You must choose / own |
|---|---|
| Component model, state/effects (hooks), reconciliation, `react-dom` | Routing, data fetching, forms, i18n, the build, SSR strategy, project structure |
| Rules and primitives | Every library that fills the gaps, and its upgrade path |

So "we use React" describes maybe 30% of the actual stack. The rest — Next.js vs React Router vs Vite SPA, Redux vs Zustand vs nothing, React Query vs hand-rolled fetching — is bespoke to each codebase.

**The architect's reading.** React optimises for **flexibility and ecosystem size** at the cost of **decision load and cross-codebase consistency**. Two React apps in the same company can look nothing alike. That's fine for a senior team building one focused product; it's a liability across 30 line-of-business apps and rotating staff, where the coherence of a framework (Angular, or React + an enforced internal meta-framework) is worth more than the flexibility.

**The mitigation at scale:** you don't ship "raw React" org-wide — you standardise on **one meta-framework** (Next.js or React Router 7) plus a blessed set of libraries and a generator, effectively building your own framework on top. Say that, and you've shown you understand the trade-off you're taking on.

---

## Q2. React vs Angular — how do you actually choose, at organisation scale?

Not on rendering speed — both are fast enough that it's rarely the deciding factor. Choose on **organisational fit and total cost of ownership**.

**Choose React when:**
- You want **maximum flexibility** and have teams senior enough to assemble and own a stack.
- You need the **largest hiring pool and ecosystem** — React's talent market is several times Angular's.
- You're betting on **Server Components / streaming SSR** via Next.js as a first-class strategy.
- The product is **one focused application** where a curated minimal stack beats a general-purpose framework.

**Choose Angular when:**
- You run **many apps and many teams** and want one enforced structure, one CLI, one upgrade path (`ng update` code-mods), one curriculum.
- You want **batteries included and vendor-supported on one version line** — router, forms, HTTP, i18n, testing, SSR.
- Your engineers come from **strongly-typed OO backgrounds** (C#/Java) — Angular's DI and class services feel native.

**The honest trade-off table:**

| Dimension | React | Angular |
|---|---|---|
| Flexibility ceiling | High | Lower |
| Consistency across *N* codebases | Low unless you impose it | High by default |
| Onboarding to *this* repo | Slower — every repo is bespoke | Fast — every Angular app is similar |
| Upgrades | You own N libraries' changelogs | One `ng update`, code-mods included |
| Bundle floor | Lower | Higher (framework runtime) |
| Hiring pool | Much larger | Smaller but stable |
| Decision fatigue | Constant | Near zero |

**Anti-pattern:** letting every squad pick per project and ending up running both at scale — double the upgrade tax, two component libraries, engineers can't move between teams. Pick one default; require a written exception to deviate.

---

## Q3. Explain the Virtual DOM, reconciliation, Fiber and keys. Is the Virtual DOM "fast"?

**Virtual DOM:** React keeps a lightweight in-memory tree of what the UI *should* be. On a state change it builds a new tree, **diffs** it against the previous one (**reconciliation**), and applies the **minimal set of real-DOM mutations**.

**Fiber** (React 16) is the reimplemented reconciler. It made rendering **incremental and interruptible** — React can render in chunks, pause for higher-priority work (a keystroke), and resume or discard — which is the foundation for concurrent features (Q11).

**Keys** give list items a **stable identity across renders** so React can tell "this row moved" from "this row is new":

```jsx
{trades.map(t => <TradeRow key={t.id} trade={t} />)}   // key = stable business id
```

Using the **array index as key** is the classic bug: insert or reorder and React mismatches state and DOM to the wrong items — an input's value jumps to the wrong row, a half-open menu attaches to the wrong record.

**Is the VDOM fast? — the nuance interviewers want.** No, the Virtual DOM is **not inherently faster than well-targeted direct DOM manipulation** — the diff itself has a cost. Its value is a **programming model**: it lets you write *declarative* UI ("render the whole thing for this state") and get *reasonable* DOM updates automatically, without hand-writing imperative patches. The performance story is "fast enough, and you didn't have to think about it."

**Be precise about the alternatives — this is where the follow-up usually goes.** **Solid** and **Svelte** skip the VDOM entirely and update the exact DOM nodes bound to a changed value; that is genuinely less runtime work, at the cost of a different mental model and a smaller ecosystem. **Angular** sits *between* the two: signals removed the global dirty-check, but a signal change still invalidates a whole **component view** rather than one text node (module **20** Q4) — so lumping Angular in with Solid as "fine-grained" is a mistake interviewers notice. React's own answer to VDOM overhead is the **React Compiler** (Q8), which auto-skips re-renders that would produce no change.

---

## Q4. What is JSX, and what does it compile to?

**Per react.dev:** JSX is *"a syntax extension for JavaScript that lets you write HTML-like markup inside a JavaScript file."* It is **not** HTML and **not** part of React — it's transformed at build time by Babel / SWC / `tsc`.

```jsx
const el = <button className="pay" onClick={submit}>Pay {amount}</button>;
```

compiles (with the **automatic runtime**, React 17+) to:

```js
import { jsx as _jsx } from "react/jsx-runtime";
const el = _jsx("button", { className: "pay", onClick: submit, children: ["Pay ", amount] });
```

(Pre-17, it compiled to `React.createElement("button", …)`, which is why every file needed `import React`.)

**Consequences an architect should be able to state:**
- The output is a **plain object** (a React *element*) — a description, not a DOM node. Rendering happens later, when React commits it.
- Because it's JavaScript, control flow is JavaScript: `&&`, ternaries, `.map()` — there is no template DSL to learn, but also no compile-time template checker beyond TypeScript.
- **`className` not `class`, `htmlFor` not `for`, camelCase events** — JSX attributes are JS props, not HTML attributes.
- `{}` embeds any expression; **whitespace and `.map()` keys** are common footguns.
- Contrast with Angular: Angular's templates are a **separate language** the compiler understands deeply (type-checked templates, structural directives). JSX is just JS, so tooling reasons about it as JS — more flexible, less template-specific safety.

---

## Q5. What are Hooks, what are the Rules of Hooks, and why did they replace classes?

**Per react.dev:** Hooks *"let you use state and other React features without writing a class."* `useState`, `useEffect`, `useContext`, `useReducer`, `useMemo`, `useRef`, `useCallback`, plus React 18/19 additions (`useTransition`, `useDeferredValue`, `useId`, `useSyncExternalStore`, `use`, `useActionState`, `useOptimistic`).

**The Rules of Hooks (enforced by `eslint-plugin-react-hooks`):**
1. **Only call hooks at the top level** — never inside conditions, loops, nested functions, or after an early `return`. React tracks hooks **by call order**; a conditional hook desynchronises that order and corrupts state.
2. **Only call hooks from React functions** — components or custom hooks, not plain functions.

**Why hooks replaced classes:**

| Class-component pain | Hooks fix |
|---|---|
| Logic reuse needed HOCs / render props → "wrapper hell" | **Custom hooks** — `useDebounce`, `usePermissions` — compose cleanly |
| Related logic split across `componentDidMount` / `DidUpdate` / `WillUnmount` | One `useEffect` co-locates setup + cleanup for one concern |
| `this` binding, `this.state` merge semantics, constructor boilerplate | No `this`; state is a local variable |
| Hard to optimise / minify, confusing to humans and tools | Plain functions and closures |

**The hazard hooks introduce — stale closures.** An effect or callback captures the `state`/`props` from the render it was created in. Forget a dependency and it reads a stale value forever. The dependency array + the lint rule exist entirely to manage this; the React Compiler reduces how often you hand-manage it.

**Classes still work** and won't be removed, but all new code is function components + hooks.

---

## Q6. `useState` vs `useReducer` vs an external store — how do you decide?

All three hold state; they differ in **where the update logic lives** and **how far the state reaches**.

| | `useState` | `useReducer` | External store (Redux Toolkit / Zustand / Jotai) |
|---|---|---|---|
| Scope | Local to one component | Local to one component | Shared across the tree, survives unmount |
| Update logic | Inline setters | A **reducer** — `(state, action) => nextState`, testable in isolation | Store-defined actions/slices |
| Best when | 1–3 independent values | Several values that **change together**, or complex transitions, or next state depends on prior | State many distant components read/write; needs DevTools, middleware, persistence |

**`useReducer` shines** when a component's state is a small machine — a multi-step trade ticket where selecting an instrument resets the tenor, clears validation, and toggles fields. Expressing that as one `dispatch({type:'INSTRUMENT_SELECTED'})` beats five `setX` calls that can interleave inconsistently.

**Reach for an external store** only when **prop-drilling or context churn actually hurts** — deeply shared state like the current user, a cart, cross-page filters. And separate the two kinds of shared state:
- **Server state** (data from an API) → a **data-fetching library** (TanStack Query, RTK Query, SWR), never a hand-rolled global store. It gives caching, dedup, background refetch, and stale-while-revalidate for free.
- **Client state** (UI that isn't on any server) → Redux Toolkit / Zustand / Jotai.

**The common mistake:** putting server data in Redux and hand-writing loading/error/cache logic. ~70% of "state management" pain is really **server-cache management**, and a query library deletes it.

---

## Q7. Explain the correct mental model for `useEffect`. What are the common misuses?

**Per react.dev:** *"`useEffect` is a React Hook that lets you synchronize a component with an external system."* The key word is **synchronize**, not "lifecycle." An effect describes: *given these reactive values, keep this external thing (a subscription, a DOM node, a non-React widget, an analytics SDK) in sync.*

```jsx
useEffect(() => {
  const sub = priceFeed.subscribe(symbol, setPrice);   // set up
  return () => sub.unsubscribe();                       // clean up before next run / on unmount
}, [symbol]);                                           // re-sync when symbol changes
```

- Effects run **after render is committed and painted**.
- The **cleanup** runs before the next effect and on unmount.
- The **dependency array** is "which reactive values, when changed, require re-synchronizing" — not a manual optimisation knob. Strict Mode double-invokes effects in dev specifically to expose missing cleanup.

**The misuses react.dev calls out explicitly ("You Might Not Need an Effect"):**

| Anti-pattern | Do instead |
|---|---|
| Effect to compute derived state from props/state (`setFullName` when `first`/`last` change) | Compute it **during render**: `const full = first + ' ' + last` |
| Effect to "reset state when a prop changes" | Give the component a **`key`** so React remounts it |
| Effect to handle a **user event** (POST on button click) | Put it in the **event handler** — effects are for synchronization, not actions |
| Effect chains that `setState` to trigger the next effect | Collapse into one calculation or one handler |
| Data fetching in a bare `useEffect` | Race conditions, request waterfalls, no cache — use a **framework loader** or **React Query** |

**The escape hatch you should be able to name — `useEffectEvent` (stable in React 19.2).** The classic bind: an effect needs the *latest* value of something but must not *re-synchronize* when that value changes. Put it in the deps and you tear down and rebuild the subscription needlessly; leave it out and you have a stale closure plus a lint error you're tempted to suppress.

```jsx
const onTick = useEffectEvent((price) => {
  analytics.track('tick', { price, theme });   // reads the LATEST theme…
});

useEffect(() => {
  const sub = priceFeed.subscribe(symbol, onTick);
  return () => sub.unsubscribe();
}, [symbol]);                                   // …but only `symbol` re-subscribes
```

`useEffectEvent` extracts the **non-reactive** part of an effect. It is the sanctioned answer to "I disabled the `exhaustive-deps` rule" — and how a candidate handles that lint rule is exactly what the question is probing. Know the constraints too: it may only be called from inside effects in the **same component**, and must not be passed to children or used as a general callback.

**Architect's rule for reviews:** most `useEffect`s in a codebase are a smell. Legitimate uses are subscriptions, non-React integrations, and imperative DOM work. If an effect only calls `setState` from other state, it shouldn't exist.

---

## Q8. What triggers a re-render, and how do `memo` / `useMemo` / `useCallback` — and the React Compiler — fit in?

**A component re-renders when:**
1. its **own state** changes (a setter is called with a new value),
2. its **parent** re-renders (by default, children re-render too),
3. a **context** it consumes changes,
4. (with `useSyncExternalStore`) a **subscribed external store** changes.

Re-render = React re-runs the function and re-diffs. It does **not** necessarily touch the DOM — reconciliation may find nothing changed. Cheap components re-rendering is usually fine; the problem is *expensive* subtrees or very frequent renders.

**The manual tools:**

| API | Purpose |
|---|---|
| `React.memo(Component)` | Skip re-render if props are shallow-equal to last time |
| `useMemo(fn, deps)` | Cache an expensive computed value between renders |
| `useCallback(fn, deps)` | Stable function identity, so a `memo`'d child or an effect dep doesn't change every render |

These are **easy to get subtly wrong** — a missing dep, an unstable object literal in props that defeats `memo`, memoising things that were never expensive (net negative).

**The React Compiler** reached **1.0 — stable — in October 2025**, so the answer here has changed: it is no longer "an experiment worth watching." It is a build-time plugin (Babel / SWC / Vite) that **auto-memoizes** components and values by analysing data flow, inserting the equivalent of `memo`/`useMemo`/`useCallback` wherever it can prove doing so is safe. Where enabled, you **delete most manual memoization** and write plain code.

Two things about it an architect must state, because they're what the follow-up asks:
- **It depends on your code following the Rules of Hooks and the rules of React** — no mutating props or state during render, no reading refs in render. Where it can't prove safety it **bails out of that component** rather than breaking it, and `eslint-plugin-react-hooks` (v6+) surfaces those bailouts. So "why didn't the compiler optimize this?" is a lint finding, not a mystery — which also makes the compiler a de-facto *correctness* audit of a legacy codebase.
- **It is not a substitute for architecture.** It removes re-render *waste*. It does not fix a 10,000-row unvirtualized grid, an N+1 fetch waterfall, a 2 MB bundle, or a context holding fast-changing state. Candidates who present it as a general performance fix get found out on the next question.

**Architect's guidance:** enable it on new codebases; adopt it incrementally on existing ones (it can be scoped by directory). Don't pre-optimize with `memo` everywhere — profile with the React DevTools Profiler and fix the specific hot subtree. The calculus has genuinely shifted from "memoize defensively" to "write plain code, let the compiler handle it, and profile the exceptions."

---

## Q9. What is the Context API for, and why is it not a state-management solution?

**Per react.dev:** Context *"lets a component provide information to the tree below it without passing props"* — it solves **prop drilling**.

```jsx
<AuthContext value={session}>        {/* React 19: <Context> is the provider */}
  <App />
</AuthContext>
// deep inside: const session = use(AuthContext);
```

**Good fits:** low-frequency, broadly-read values — theme, locale, current user/permissions, a design-system config. Things that change rarely and are needed everywhere.

**Why it is not a state manager:**

| Limitation | Consequence |
|---|---|
| **No selectors.** Any change to the context value re-renders **every** consumer | A context holding a big object that updates often causes app-wide re-render storms |
| No batching of partial updates | You can't subscribe to "just `user.name`" |
| No middleware, devtools, persistence, async handling | You rebuild all of it by hand |
| Value identity matters | Forget to `useMemo` the value and every render re-triggers all consumers |

**Architect's position:** Context is a **transport mechanism**, not a store. For frequently-changing shared state use a real store (Zustand/Jotai/Redux Toolkit) whose subscriptions are **selective** — components re-render only when the slice they read changes. A common healthy pattern: Context to *inject* a store instance or a stable service, the store itself to *hold and notify* changing state. Splitting one big context into several narrow ones is a valid mitigation, but if you're doing that a lot, you wanted a store.

---

## Q10. How do you choose a state-management approach (Redux Toolkit / Zustand / TanStack Query / …)?

**Step one: split state by kind — this decides most of it.**

| Kind | Examples | Tool |
|---|---|---|
| **Server state** | API data — accounts, trades, prices | **TanStack Query / RTK Query / SWR** — caching, dedup, background refetch, stale-while-revalidate |
| **URL state** | filters, tab, pagination, selected id | The **router** (search params) — shareable, back-button-correct |
| **Client/UI state** | modal open, wizard step, unsaved form, theme | `useState`/`useReducer`, or a client store if widely shared |
| **Form state** | field values, validation, submission | **React Hook Form** (or React 19 Actions for simple cases) |

Most apps discover that once server state is in a query library and URL state is in the router, the "global client state" that remains is small.

**For that remaining client state:**

| Option | Character | Pick when |
|---|---|---|
| **Redux Toolkit** | Official, opinionated, structured (slices, immutable updates via Immer, DevTools, middleware) | Large team wanting enforced structure; complex cross-cutting state; a **replayable action log** is valuable (regulated/audited apps); heavy time-travel debugging need |
| **Zustand** | Tiny hook-based store, no provider, minimal boilerplate | Most apps — shared state without ceremony |
| **Jotai / Recoil** | Atomic — compose state from small atoms | Fine-grained, derived, spreadsheet-like state graphs |
| **Nothing (just hooks + context)** | — | Small app; shared state is shallow |

**Architect's guidance:** start minimal (query library + router + hooks). Add a client store when prop-drilling or context re-renders actually hurt — not because "real apps use Redux." Redux Toolkit specifically earns its weight when the *audit trail and structure* are features, which is a genuine draw in fintech; otherwise Zustand covers the need with a fraction of the code.

---

## Q11. What is concurrent rendering? Explain `useTransition` and `useDeferredValue`.

**Per the React 18 release:** concurrent rendering lets React *"prepare multiple versions of the UI at the same time"* — rendering becomes **interruptible**: React can start rendering an update, pause it for a more urgent one (a keystroke), and resume or throw it away. Nothing "blocks the main thread for 200ms" the way a synchronous render could.

It's opt-in through features, not a switch you flip:

**`useTransition` / `startTransition`** marks an update as **non-urgent**:

```jsx
const [isPending, startTransition] = useTransition();

function onFilterChange(text) {
  setQuery(text);                                   // urgent: input stays responsive
  startTransition(() => setResults(filter(text)));  // non-urgent: heavy list can be interrupted
}
```

The typeahead input never stutters even while a 5,000-row result grid re-renders, because React yields to keystrokes and abandons stale renders. `isPending` drives a subtle loading affordance.

**`useDeferredValue`** does the same from the consumer side — it hands you a **lagging copy** of a value that updates at lower priority:

```jsx
const deferredQuery = useDeferredValue(query);
const rows = useMemo(() => filter(deferredQuery), [deferredQuery]);   // recompute off the deferred value
```

Use it when you don't own the setter (the value comes from props or context).

**Architect's framing:** these target **INP / input latency** on genuinely expensive screens — dense grids, big charts, live-filtered blotters. They don't make rendering *faster*; they make it *non-blocking* so the UI stays interactive. Automatic batching (all updates, not just event handlers) also shipped in 18 and reduces redundant renders for free.

---

## Q12. Explain Suspense, error boundaries, streaming SSR and the `use()` API.

**Suspense** lets you *"declaratively specify the loading UI for a part of the component tree if it's not yet ready to be displayed"*:

```jsx
<Suspense fallback={<PortfolioSkeleton />}>
  <PortfolioPanel />        {/* may "suspend" while its code or data loads */}
</Suspense>
```

A component "suspends" by throwing a promise (in practice, via a framework's data layer, `React.lazy`, or `use()`). React shows the nearest `fallback` until it resolves, then swaps in the real content — no manual `isLoading` wiring, and boundaries **nest** so you control granularity.

**Streaming SSR** (`renderToPipeableStream`, React 18): the server sends HTML **as it becomes ready** instead of waiting for the whole page. The shell and fast content paint immediately; slow sections stream in inside their Suspense boundaries. **Selective hydration** then hydrates regions as their JS arrives and prioritises the one the user just interacted with. Result: better TTFB and TTI, and a slow data call for one panel no longer blocks the entire page.

**`use()`** (React 19): reads the value of a **promise** or **context** during render, integrating with Suspense and error boundaries:

```jsx
function Comments({ commentsPromise }) {
  const comments = use(commentsPromise);   // suspends until resolved; unlike hooks, may be called conditionally
  return comments.map(c => <Comment key={c.id} {...c} />);
}
```

Promises passed to `use()` should be **created by a framework or a cache**, not inline in render (a new promise every render = infinite suspense).

**Suspense's sibling: error boundaries.** Suspense handles *"not ready yet"*; an **error boundary** handles *"it failed."* Anything that can suspend can also throw, so in practice you place them together — a panel gets a `<Suspense>` for loading and an error boundary for failure, so one broken widget degrades to a message instead of blanking the page.

**What error boundaries do *not* catch — a reliable discriminator question:**

| Not caught | Handle with |
|---|---|
| Errors thrown in **event handlers** | `try/catch` in the handler; surface via state |
| **Async** errors — `setTimeout`, unhandled promise rejections outside render | `.catch()` / `try/catch`; route into your error state |
| Errors thrown in the **error boundary itself** | A boundary above it |
| **Server-rendering** errors | The SSR hooks (`onError` in `renderToPipeableStream`) |

React 19 added root-level **`onCaughtError` / `onUncaughtError`** options, so boundary-caught and escaped errors can be piped into Sentry/Datadog centrally instead of per-boundary. **Architect's rules:** a boundary at route level *and* around each independently-failable panel; **never** a single boundary at the app root (that turns any leaf bug into a white screen); and never a boundary that swallows an error without reporting it — a silently-degraded payments screen is worse than a crashed one, because nobody gets paged.

**Architect's caution:** Suspense-for-data is powerful but is really meant to be driven by a **framework's data layer** (Next.js, React Router) or a cache (React Query). Hand-rolling suspense-throwing fetches leads to waterfalls and cache bugs.

---

## Q13. What are React Server Components, and where does code actually run?

**Per the React docs:** Server Components are *"a new type of Component that renders ahead of time, before bundling, in an environment separate from your client app or SSR server."* They run on the **server (per request) or at build time**, and **never ship to the browser**.

| | Server Component (default in RSC frameworks) | Client Component (`"use client"`) |
|---|---|---|
| Runs | Server / build only | Server (SSR) **and** browser (hydration + interactions) |
| Ships JS to client | **No** — zero bundle cost | Yes |
| Can be `async`, hit DB/filesystem/secrets directly | **Yes** | No |
| Can use state, effects, event handlers, browser APIs | **No** | Yes |
| Can import the other kind | Can render Client Components | Cannot import Server Components (but can receive them as `children`) |

`"use client"` marks the **boundary** where the client bundle begins; everything below it is client code. Props crossing server→client must be **serializable** (no functions except Server Actions, no class instances).

**Why it matters architecturally:**
- **Data fetching moves into the component tree, on the server** — no `useEffect` fetch, no client-exposed API keys, no over-fetching. A component `await`s the DB and renders.
- **Bundle size drops** — heavy formatting/markdown/date libraries used only for rendering stay on the server.
- **New trust boundary** — the server/client serialization edge. What you pass down is visible in the payload; secrets stay in Server Components.
- **Framework-coupled** — RSC needs a bundler *and* router integration you don't write yourself. **Next.js App Router** is still the most mature implementation, but it is no longer the only door: **React Router 7**, **Vite** (via its RSC plugin) and **Parcel** all support RSC now. The architectural point survives the ecosystem change: adopting RSC means adopting a framework and its data/routing conventions — *that* is the decision you're actually making, not the component model.

**When to skip it:** a pure SPA behind auth (internal trading tool) with no SEO need and a team that doesn't want to run/scale a Node server gets little from RSC and takes on real complexity.

---

## Q14. Explain Actions, Server Actions, `useActionState` and `useOptimistic` (React 19).

React 19 formalised **async data mutations** ("Actions") into the framework so you stop hand-wiring pending/error/optimistic state.

**Actions** — an async function passed to a transition (or a `<form action>`). React tracks pending state, errors, and ordering:

```jsx
function PayButton({ invoiceId }) {
  const [state, submitAction, isPending] = useActionState(
    async (_prev, formData) => {
      const res = await pay(invoiceId, formData.get('amount'));
      return res.ok ? { ok: true } : { error: res.error };
    },
    { ok: false }
  );
  return (
    <form action={submitAction}>
      <input name="amount" />
      <button disabled={isPending}>Pay</button>
      {state.error && <p role="alert">{state.error}</p>}
    </form>
  );
}
```

- **`useActionState`** — wraps an action, returns `[state, wrappedAction, isPending]`. No manual `useState` for loading/error.
- **`useFormStatus`** — a child (e.g. a submit button in a design system) reads the parent form's pending state without prop-drilling.
- **`useOptimistic`** — render an optimistic value immediately, auto-revert if the action fails: the transfer appears in the list instantly, rolls back on error.

**Server Functions** (`"use server"`) — functions defined on the server but **callable from client components**, including as a `<form action>`. The framework generates the RPC; you write a function. They're how RSC apps mutate data without hand-writing API routes.

**Get the terminology right, because React's docs tightened it:** a **Server Function** is the general primitive; a **Server Action** now means specifically a Server Function passed to `action`/`formAction` or invoked inside a transition. Most blog posts still use "Server Action" for both. Using the current distinction unprompted reads as someone who follows the source rather than the commentary — a small thing that lands well at this bar.

**Architect's caution, and the single most common RSC security mistake:** a Server Function is a **public HTTP endpoint**. The `"use server"` directive generates a callable route reachable by anyone who can craft the request — the fact that your UI only calls it from an admin screen protects nothing. **Authenticate and authorize *inside* every Server Function, and validate every input** (Zod or equivalent), exactly as you would an ASP.NET Core controller action, because that is precisely what it is. Two corollaries worth stating: closed-over variables are serialized into the client payload, so never close over a secret; and these endpoints need the same rate limiting, audit logging and idempotency keys (Module 14 Q24–Q25) as any other mutation surface in a regulated system.

---

## Q15. CSR vs SSR vs SSG vs ISR — how do you choose a rendering strategy?

| Strategy | HTML produced | Strengths | Costs |
|---|---|---|---|
| **CSR** (SPA) | Empty shell + JS; browser renders | Simplest ops (static hosting/CDN); great for app-like UIs behind auth | Poor SEO; slow first paint on weak devices; big JS upfront |
| **SSR** | Full HTML **per request**, then hydrate | Fast first contentful paint; SEO; personalised pages | You run and scale a **Node/edge server**; TTFB tied to your data latency; hydration cost |
| **SSG** | Full HTML **at build time** | Fastest + cheapest (pure CDN); very robust | Only for content known at build; rebuild to update; long builds at scale |
| **ISR** (Next.js) | SSG + background regeneration (interval / on-demand) | Static speed with fresh-ish content | Framework-specific; caching semantics to reason about; stale window |

**How to decide — per route, not per app:**
- **Public, SEO-critical, content-ish** (marketing, pricing, disclosures, help) → **SSG/ISR**.
- **Public, personalised or fast-changing** (a logged-in dashboard landing, search results) → **SSR** (ideally streaming).
- **Deep app screens behind login** (a trading blotter, an admin console) → **CSR** is often correct — no SEO need, and you avoid operating an SSR tier.
- Meta-frameworks (Next.js App Router, React Router 7) let you **mix per route**, which is the point.

**Architect's caveats:**
- **Hydration is not free** — SSR/SSG still ship and execute JS to make the page interactive; a heavy page can paint fast but stay unresponsive (bad INP). Measure LCP **and** INP/TBT.
- SSR adds an **operational tier**: deploy, scale, memory, cold starts, an SSR-broke-prod failure mode CSR doesn't have.
- "SSR for speed" backfires if your API is slow — TTFB now includes that call. Fix data latency first or stream.

---

## Q16. What changed in React 19 that matters to an architect?

React 19 (stable, late 2024) is mostly about **removing boilerplate and blessing patterns**:

| Change | Why it matters |
|---|---|
| **Actions / `useActionState` / `useFormStatus` / `useOptimistic`** | Built-in pending/error/optimistic handling for mutations — deletes a category of hand-rolled `useState` wiring and buggy optimistic code (Q14) |
| **`use()`** | Read promises/context in render, integrates with Suspense; can be called conditionally (unlike hooks) |
| **Server Components & Server Actions stabilised** | RSC is now a supported API for frameworks, not experimental (Q13–Q14) |
| **`ref` as a regular prop** | `forwardRef` is no longer needed — simplifies component libraries |
| **`<Context>` as provider** | `<Context.Provider>` shorthand — minor ergonomics |
| **Document Metadata** | `<title>`, `<meta>`, `<link>` rendered anywhere hoist into `<head>` — less need for `react-helmet` |
| **Stylesheet / async script support** | Ordered stylesheets and deduped async scripts in components |
| **Better hydration error messages** | Real diffs instead of cryptic mismatch warnings — meaningful debugging-time saving |
| **Improved error handling** | No more duplicate logged errors; `onCaughtError` / `onUncaughtError` root options |

**Don't stop your answer at 19.0 — the 19.x line kept adding things that matter:**

| Release | Added |
|---|---|
| **19.1** | **Owner Stacks** — dev-only stacks showing which component *rendered* the one that threw, rather than just DOM ancestry; materially faster debugging in deep trees |
| **19.2** | **`<Activity>`**; **`useEffectEvent`** stable (Q7); **`cacheSignal`**; **Partial Pre-rendering**; performance tracks in React DevTools |

**`<Activity>` is the one with real architectural leverage.** Switching tabs or views in a heavy app has always forced a bad choice: unmount (lose scroll position and local state, pay the full re-mount cost) or keep everything mounted (pay the render and effect cost forever). `<Activity mode="hidden">` gives a third option — **state preserved, effects torn down, and the subtree pre-rendered at low priority**. For a multi-tab trading console or an admin app with expensive panels, that is the difference between an instant switch and a 300 ms stall.

**The upgrade itself:** React 19 has **breaking changes** — legacy `ReactDOM.render` removed (use `createRoot`), string refs gone, `propTypes`/`defaultProps` for function components gone, some TS type tightening. There's a codemod (`npx codemod@latest react/19/migration-recipe`). Non-trivial but not a rewrite; the React 18 → 19 path is well-supported. The realistic blockers are third-party libraries that haven't shipped React 19 peer support — survey those *before* you schedule the upgrade, because that, not React itself, is what stalls it.

**Architect's read:** 19 pushes React toward "the framework handles mutations, metadata, and server rendering." If you're on Next.js App Router you're already living in this model; if you're a Vite SPA, adopt Actions and `use()` opportunistically, and turn on the **React Compiler** — now that it's 1.0 (Q8), that's the highest-leverage item on the list, not an experiment to evaluate.

---

## Q17. How do you approach performance in a React app?

**Split into load-time and runtime; measure with Lighthouse, the React DevTools Profiler, and bundle analysis — not intuition.**

**Load time:**
- **Route-based code splitting** — `React.lazy` + `Suspense`, or the framework's automatic per-route splitting. Initial bundle = shell + first view.
- **Component-level lazy loading** for heavy, below-the-fold widgets (charts, editors, maps) and their dependencies.
- **Analyze the bundle** (`vite-bundle-visualizer`, `@next/bundle-analyzer`); watch for a date/locale/icon library pulling in 200KB.
- **Set a bundle budget in CI** so a regression fails the build.
- **RSC / SSG** to move rendering-only code and data fetching off the client where the app shape allows.
- Ship **modern JS** (no needless legacy transpilation); tree-shake; defer non-critical third-party scripts (analytics, chat).

**Runtime:**
- **Profile first** — find the specific subtree that re-renders too often or too expensively.
- **Stabilise props** and apply `React.memo` to the hot child; memoize genuinely expensive computations with `useMemo` — or adopt the **React Compiler** and stop hand-memoizing.
- **Correct `key`s** on lists — stable business ids, never the array index for dynamic lists.
- **Virtualize long lists/grids** (TanStack Virtual, react-window) — render the visible window, not 10,000 rows.
- **`useTransition` / `useDeferredValue`** to keep input responsive while expensive views update (Q11).
- **Lift state down, not up** — local state that lives in a leaf doesn't re-render the tree.
- **Don't put fast-changing values in a broad Context** (Q9).

**The fintech-specific one:** a real-time grid taking hundreds of updates/second must **batch** them (buffer ~100ms, apply once) and pair virtualization + memoized rows + stable keys. Rendering per tick is what makes these UIs janky.

---

## Q18. How do you test a React application?

**The pyramid:**

| Level | Tool | Tests |
|---|---|---|
| **Unit** | Vitest / Jest | Pure functions, reducers, custom hooks (`@testing-library/react`'s `renderHook`), utilities |
| **Component / integration** | **React Testing Library** + Vitest/Jest, **MSW** for network | A component or feature from the **user's** perspective — query by role/label/text, interact, assert on output |
| **E2E** | **Playwright** or Cypress | Full journeys against a running build |
| **Visual / a11y** | Storybook + Chromatic, `axe` | Regression on appearance and accessibility |

**React Testing Library's philosophy** (worth stating): *"test your components the way your users use them."* Query by accessible role and text, fire real events, assert on visible output. **Don't** assert on state, props, or component internals — those are implementation details, and coupling tests to them makes every refactor break the suite. Enzyme (the old internals-focused library) is effectively dead for this reason.

**Architect's standards:**
- **MSW** to intercept `fetch`/XHR at the network layer — same mocks in tests, Storybook, and local dev; no `jest.mock('axios')` brittleness.
- **`userEvent`** over `fireEvent` — it simulates real interaction sequences (focus, keydown, input).
- Test **behaviour and edge cases** (empty, error, loading, permission-denied, boundary amounts), not that a `<div>` rendered. Include the **error boundary** paths (Q12) — an untested failure path is an untested failure path whether or not React catches it.
- **Accessibility is a test level, not polish.** `@axe-core/playwright` in e2e and `jest-axe`/`vitest-axe` at component level, in CI. For a bank this is a **legal** obligation: **WCAG 2.2 AA** is the reference standard, and the **European Accessibility Act** became enforceable in **June 2025** for consumer-facing financial services in the EU (with ADA pressure in the US and public-sector equivalents elsewhere). Be honest about the limits — automated checks catch roughly 30–40% of real issues, so pair them with periodic manual and screen-reader audits. RTL helps here structurally: because it queries by **accessible role and name**, a component that's hard to test is usually a component that's hard to use with a screen reader.
- **Vitest** is now the common default for new apps (Vite-native, fast, Jest-compatible API).
- **CI gates:** typecheck, lint (including `eslint-plugin-react-hooks` — which also gates React Compiler optimisability, Q8), unit + component coverage threshold, an `axe` pass, a bundle budget, and a Playwright smoke suite on the critical flow (for payments: "a user can complete a payment").

---

## Q19. How does React protect against XSS, and where do you store auth tokens?

**Per react.dev:** *"React DOM escapes any values embedded in JSX before rendering them… everything is converted to a string before being rendered."* So `<div>{userInput}</div>` is **safe by default** — markup in `userInput` renders as text, not HTML.

**Where that protection ends — every one is a review flag:**

| Hole | Guidance |
|---|---|
| **`dangerouslySetInnerHTML={{__html: x}}`** | The deliberate bypass. If `x` is ever user/third-party-influenced, sanitize with **DOMPurify** first — and ideally sanitize server-side too |
| **`href` / `src` from user input** | `<a href={userUrl}>` can be `javascript:...`. Validate the scheme (`https:`/`mailto:` allowlist) |
| **Spreading unknown props** `{...userObj}` onto an element | Can inject event handlers or `dangerouslySetInnerHTML` |
| **Injecting into `<script>`, `<style>`, JSON embedded in HTML** (SSR) | Escape for the context; use a vetted serializer |
| **`ref` + direct DOM writes** (`el.innerHTML = …`) | Bypasses React entirely |

**Token storage — the standard architect answer:**
- **Prefer an `httpOnly`, `Secure`, `SameSite=Lax/Strict` cookie** for the session/refresh token. JavaScript can't read it, so an XSS bug can't exfiltrate it. Pair with **CSRF defense** (SameSite + a CSRF token or double-submit) since cookies auto-attach.
- **Avoid `localStorage`/`sessionStorage` for tokens** — any XSS (including from a compromised npm dependency) reads them instantly. If a SPA architecture forces a readable access token, keep it **in memory only**, short-lived, with the refresh token in an httpOnly cookie (BFF pattern).
- Best for browser apps: a **Backend-for-Frontend** holds the tokens server-side and the browser just gets a session cookie.

**Plus the platform controls:** a strict **Content-Security-Policy** (`script-src 'self'`, no `unsafe-inline`), **Subresource Integrity** on any CDN script, and **supply-chain hygiene** — lockfiles, `npm audit`/Dependabot, minimal dependencies, and provenance checks (a malicious transitive dependency is a realistic XSS/exfiltration vector in the React ecosystem). And the constant: **the client cannot enforce authorization** — every API call and Server Action re-checks.

---

## Q20. CRA is deprecated — how do you start and sustain a React codebase now (framework choice, upgrades, micro-frontends)?

**Starting a project.** `react.dev`'s "Start a New React Project" no longer recommends Create React App (officially **deprecated, Feb 2025**). The options:

| Choice | When |
|---|---|
| **Next.js (App Router)** | You want RSC, streaming SSR, file-based routing, image/font optimization, and Server Actions out of the box; SEO or personalised SSR matters; you're OK running/deploying on a Node/edge platform |
| **React Router 7 (framework mode)** | You want a lighter meta-framework with loaders/actions, SSR optional, less lock-in. Remix v2 merged into it, and the Remix team has signalled a future v3 on a different, non-React foundation — so **React Router 7 is the continuity path** for a React codebase, not Remix |
| **Vite SPA** (`npm create vite`) | Pure client app behind auth (internal trading tool, admin console); no SEO need; you want minimal ops and full control |
| **Expo** | React Native / cross-platform |

**Architect's decision:** pick **one blessed setup for the org**, wrap it in a generator + a shared config + a component library, and require an exception to deviate. "We use React" is not a standard; "we use Next.js App Router with this lint config, this data layer, and this design system" is.

**Sustaining it:**
- **Upgrade cadence.** React itself moves slowly (18 → 19 over ~2 years) — low churn. The churn is in the **surrounding libraries**; keep the set small and well-maintained, use Renovate/Dependabot, and run majors through a canary branch + full test/e2e before adopting.
- **Turn on the React Compiler** (1.0 since October 2025) to cut manual memoization debt and, as a side effect, get a standing audit of Rules-of-React violations (Q8).
- **Codemods** exist for React's own breaking changes (`npx codemod react/19/migration-recipe`) — use them.
- **TypeScript strict**, `eslint-plugin-react-hooks`, and a bundle budget in CI are the non-negotiable guardrails on a flexible stack.
- **Write down the stack decisions**, not just the code — an ADR per choice (router, data layer, forms, styling, testing). On a framework this flexible, the undocumented choices are what make the codebase unmaintainable three years and two team rotations later. This is the single biggest difference between a React estate that ages well and one that doesn't.

**Micro-frontends** (if org structure demands independent deployment): **Module Federation** (Webpack/Rspack) is the usual mechanism, and React's small runtime + flexibility make it **lighter than with Angular**. Real hazards: multiple React copies breaking hooks (share `react`/`react-dom` as singletons), version skew across remotes, and a duplicated design system. As with Angular, prefer a **well-modularised monorepo (Nx / Turborepo) with enforced boundaries** first; adopt MFE only when independent *deployment* — not just independent *code ownership* — is the binding constraint.

---

## References — official documentation

| Topic | Source |
|---|---|
| React — home / "the library for web and native UIs" | https://react.dev/ |
| React — Describing the UI (components, JSX) | https://react.dev/learn/describing-the-ui |
| React — Writing markup with JSX | https://react.dev/learn/writing-markup-with-jsx |
| React — JSX transform (automatic runtime) | https://legacy.reactjs.org/blog/2020/09/22/introducing-the-new-jsx-transform.html |
| React — Rendering lists / keys | https://react.dev/learn/rendering-lists |
| React — Preserving and resetting state (keys, reconciliation) | https://react.dev/learn/preserving-and-resetting-state |
| React — Rules of Hooks | https://react.dev/reference/rules/rules-of-hooks |
| React — `useState` | https://react.dev/reference/react/useState |
| React — `useReducer` | https://react.dev/reference/react/useReducer |
| React — `useEffect` | https://react.dev/reference/react/useEffect |
| React — `useEffectEvent` | https://react.dev/reference/react/useEffectEvent |
| React — You Might Not Need an Effect | https://react.dev/learn/you-might-not-need-an-effect |
| React — `useMemo` / `useCallback` / `memo` | https://react.dev/reference/react/useMemo |
| React — `useContext` / Passing data deeply with context | https://react.dev/learn/passing-data-deeply-with-context |
| React — Scaling up with reducer and context | https://react.dev/learn/scaling-up-with-reducer-and-context |
| React — `useTransition` | https://react.dev/reference/react/useTransition |
| React — `useDeferredValue` | https://react.dev/reference/react/useDeferredValue |
| React — `<Suspense>` | https://react.dev/reference/react/Suspense |
| React — `<Activity>` | https://react.dev/reference/react/Activity |
| React — Error boundaries (`Component`, `createRoot` error options) | https://react.dev/reference/react/Component#catching-rendering-errors-with-an-error-boundary |
| React — Rules of React (what the Compiler relies on) | https://react.dev/reference/rules |
| React — `use` | https://react.dev/reference/react/use |
| React — `useActionState` | https://react.dev/reference/react/useActionState |
| React — `useOptimistic` | https://react.dev/reference/react/useOptimistic |
| React — `useFormStatus` | https://react.dev/reference/react-dom/hooks/useFormStatus |
| React — Server Components | https://react.dev/reference/rsc/server-components |
| React — Server Functions / `"use server"` | https://react.dev/reference/rsc/server-functions |
| React — `"use client"` | https://react.dev/reference/rsc/use-client |
| React blog — React 18 (concurrent rendering, streaming SSR) | https://react.dev/blog/2022/03/29/react-v18 |
| React blog — React 19 | https://react.dev/blog/2024/12/05/react-19 |
| React — React Compiler (1.0, October 2025) | https://react.dev/learn/react-compiler |
| React blog — release announcements (19.1 Owner Stacks, 19.2 `<Activity>` / `useEffectEvent`, Compiler 1.0) | https://react.dev/blog |
| React — `createRoot` / `hydrateRoot` | https://react.dev/reference/react-dom/client/createRoot |
| React — `renderToPipeableStream` (streaming SSR) | https://react.dev/reference/react-dom/server/renderToPipeableStream |
| React — Start a New React Project | https://react.dev/learn/start-a-new-react-project |
| React — Creating a React App / build-from-scratch | https://react.dev/learn/build-a-react-app-from-scratch |
| Create React App — deprecation notice | https://react.dev/blog/2025/02/14/sunsetting-create-react-app |
| React — `dangerouslySetInnerHTML` | https://react.dev/reference/react-dom/components/common#dangerously-setting-the-inner-html |
| React Testing Library — guiding principles | https://testing-library.com/docs/guiding-principles/ |
| React Testing Library — React | https://testing-library.com/docs/react-testing-library/intro/ |
| MSW — Mock Service Worker | https://mswjs.io/docs/ |
| Deque — axe-core accessibility testing engine | https://github.com/dequelabs/axe-core |
| W3C — WCAG 2.2 | https://www.w3.org/TR/WCAG22/ |
| European Accessibility Act — Directive (EU) 2019/882 | https://eur-lex.europa.eu/eli/dir/2019/882/oj |
| Vitest | https://vitest.dev/guide/ |
| Playwright | https://playwright.dev/docs/intro |
| Next.js — App Router / rendering | https://nextjs.org/docs/app/building-your-application/rendering |
| Next.js — Incremental Static Regeneration | https://nextjs.org/docs/app/building-your-application/data-fetching/incremental-static-regeneration |
| React Router 7 — framework vs library mode | https://reactrouter.com/start/modes |
| TanStack Query — overview | https://tanstack.com/query/latest/docs/framework/react/overview |
| Redux Toolkit — why RTK | https://redux-toolkit.js.org/introduction/getting-started |
| Zustand | https://zustand.docs.pmnd.rs/ |
| TanStack Virtual (list virtualization) | https://tanstack.com/virtual/latest |
| Module Federation | https://module-federation.io/ |
| OWASP — DOM XSS / cross-site scripting | https://owasp.org/www-community/attacks/xss/ |
| OWASP Cheat Sheet — Cross-Site Scripting Prevention | https://cheatsheetseries.owasp.org/cheatsheets/Cross_Site_Scripting_Prevention_Cheat_Sheet.html |
| MDN — Content Security Policy | https://developer.mozilla.org/docs/Web/HTTP/CSP |
| web.dev — Core Web Vitals (LCP, INP, CLS) | https://web.dev/articles/vitals |

---

**Previous:** [20 — Angular](./20-Angular.md)
