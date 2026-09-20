# Angular & React — Cram Sheet

> Tier 3 (thin recall) · Source: `42-Angular/` + `43-React/` (7 modules, 4,236 lines) · Read: 8 min
> For a backend-leaning Principal/Architect role you need **architectural literacy**, not framework depth. Know the trade-offs and the integration boundary.

---

## 1. The comparison (the question you'll get)

| | **Angular** | **React** |
|---|---|---|
| Type | **framework** — batteries included | **library** — you assemble the rest |
| Language | TypeScript, opinionated | JS/TS, unopinionated |
| DI | **built-in hierarchical injector** | none (context/props) |
| Data flow | two-way binding available | **one-way**, explicit |
| Change detection | **Zone.js** dirty checking → **Signals** (v16+) | Virtual DOM diff + reconciliation → **Fiber** |
| Routing/HTTP/forms | **included** (Router, `HttpClient`, Reactive Forms) | third-party (React Router, fetch/axios, RHF) |
| State | RxJS services / NgRx | useState/useReducer/Context → Redux Toolkit, Zustand, TanStack Query |
| Async idiom | **RxJS Observables** everywhere | Promises + hooks |
| Best for | **large enterprise teams, long-lived apps, consistency** | flexibility, ecosystem, hiring pool |

**The answer they want:** Angular's opinions are the point in a large organisation — DI, structure and tooling are decided for you, so 200 engineers write similar code and onboarding is cheap. React's flexibility is the point when you need speed and ecosystem, at the cost of every team making its own architectural choices. **For a regulated enterprise with many long-lived internal apps, Angular's consistency usually wins; for a product org iterating fast, React.**

---

## 2. React essentials

- **Virtual DOM + reconciliation:** render produces a tree, React diffs against the previous one and applies minimal DOM mutations. **Keys** let it match list items across renders — **an index as a key breaks state on reorder**, the classic bug.
- **Fiber** enables interruptible rendering, priorities and concurrent features (`useTransition`, `Suspense`).
- **Hooks rules:** only at the top level, only in components/hooks — because hooks are matched **by call order**, not by name.
- `useState` · `useEffect` (side effects; **the dependency array is the bug farm** — missing deps give stale closures, unstable deps give infinite loops) · `useMemo`/`useCallback` (**memoisation is not free — measure first**) · `useRef` (mutable value that doesn't re-render) · `useContext` (**a context change re-renders every consumer** — split contexts or use a store).
- **State placement is the real skill:** local → lifted → context → a store. **Server state is not client state** — use TanStack Query / RTK Query for caching, revalidation and deduplication rather than hand-rolling it into Redux.
- **Redux Toolkit** is the modern Redux; raw Redux boilerplate is a dated answer.
- **Performance:** `React.memo`, virtualisation for long lists, code splitting with `lazy`/`Suspense`, avoid creating new object/function identities in render.
- **Rendering strategies:** CSR · SSR · SSG · ISR · **React Server Components** (Next.js App Router) — know what each buys (TTFB, SEO, bundle size).

---

## 3. Angular essentials

- **Modules → standalone components** (v14+ standalone is now the default direction; `NgModule` is legacy).
- **Change detection:** Zone.js monkey-patches async APIs and triggers a check of the whole tree. **`OnPush`** limits checks to input-reference changes and events — the standard performance fix. **Signals (v16+)** move Angular to fine-grained reactivity and, with zoneless, remove Zone.js entirely. **This is the modernity question — mention Signals.**
- **DI is hierarchical** — `providedIn: 'root'` (singleton, tree-shakeable) vs component-level providers (a new instance per component). Structurally similar to ASP.NET Core's container, which is a nice thing to say.
- **RxJS is the idiom**: `switchMap` (cancel the previous — correct for typeahead/search) · `mergeMap` (concurrent) · `concatMap` (ordered) · `exhaustMap` (ignore while in flight — correct for submit buttons). **Picking the right flattening operator is *the* Angular interview question.**
- **`async` pipe** handles subscribe *and* unsubscribe — **manual `subscribe()` without `takeUntilDestroyed()` is the classic memory leak.**
- **Reactive Forms** (typed, testable, dynamic) over Template-driven.
- Interceptors for auth headers, retries and correlation ids — the direct analogue of ASP.NET Core middleware.
- **Ahead-of-Time compilation** is default; `ng build` with budgets catches bundle bloat.

---

## 4. What an architect is actually asked about

- **Micro-frontends** — Module Federation. Independent deploy per team, at the cost of duplicated dependencies, version skew, shared-state complexity and a much harder debugging story. **Only when team autonomy is the real problem**; otherwise a modular monolith frontend.
- **BFF pattern** — a backend per client type, so the frontend never orchestrates across microservices and payloads fit the client. **Pair this with the token answer: tokens stay server-side in the BFF; the browser holds an `HttpOnly` cookie. Never store tokens in `localStorage` (XSS-readable).**
- **Frontend security:** XSS (both frameworks escape by default — the holes are `dangerouslySetInnerHTML` and `bypassSecurityTrustHtml`) · CSP · CSRF for cookie auth · **never trust client-side validation or client-side authorization — the UI hiding a button is not an access control.**
- **Performance budgets** — bundle size, Core Web Vitals (LCP/INP/CLS) as CI gates.
- **SSR/SSG** for TTFB and SEO; hydration cost is the trade.
- **Accessibility (WCAG)** and internationalisation are real enterprise requirements, not nice-to-haves.
- **Testing:** unit (Jest/Vitest, Karma) → component (Testing Library) → E2E (Playwright/Cypress), same pyramid economics as the backend.

---

## Top traps

1. Array index used as a React `key`.
2. `useEffect` dependency array wrong → stale closure or infinite loop.
3. `useMemo`/`useCallback` applied everywhere without measuring.
4. One giant context re-rendering the whole app.
5. Server state kept in Redux instead of a query cache.
6. Angular: manual `subscribe()` with no unsubscribe → leak.
7. Angular: wrong flattening operator (`mergeMap` for typeahead instead of `switchMap`).
8. Not knowing Signals / still describing `NgModule` as current.
9. Tokens in `localStorage`.
10. Micro-frontends proposed without a team-autonomy problem to solve.

---

## 30-second answers

- **"Angular or React for an enterprise app?"** → Angular, usually, and for organisational rather than technical reasons: DI, routing, HTTP, forms and structure are decided, so a large team writes consistent code and onboarding is cheap. React's flexibility is genuinely better when you want speed and ecosystem, but every team then makes its own state-management and structure decisions, and across twenty internal apps that divergence is the real cost. I'd pick React where hiring pool and iteration speed dominate.
- **"How does change detection differ?"** → React re-renders a component subtree and diffs a virtual DOM against the previous render, applying minimal mutations — Fiber makes that interruptible and prioritised. Angular has historically used Zone.js, which patches async APIs and then dirty-checks the component tree, with `OnPush` as the standard way to prune that. The important current detail is Signals in v16+, which move Angular to fine-grained reactivity and allow zoneless — that's the direction of travel, and it converges with how React's newer model reasons about updates.
- **"Where do you put auth tokens in a SPA?"** → Not in `localStorage` — any XSS reads it. I'd use the BFF pattern: the backend-for-frontend holds the tokens server-side and the browser gets an `HttpOnly`, `Secure`, `SameSite` cookie, which means I also need CSRF protection. That keeps the refresh token entirely out of reach of the browser, and it lets the BFF do the token refresh and the per-client aggregation, so the SPA isn't orchestrating calls across microservices either.

---

**Go deeper:** `42-Angular/`, `43-React/` · **Related:** [[03-REST-APIs]], [[41-OAuth2-OIDC-JWT]], [[38-APIGateway-ServiceMesh-IAM]]
