# 20. Angular — 20 Questions (Answered)

> **Method:** every definition is taken from the **official Angular documentation** (`angular.dev` — the Guide, the API reference and the *Best Practices* pages), supplemented by the **RxJS documentation**, the **TypeScript handbook**, the **Angular blog** release notes, and **web.dev / MDN** for the browser-platform mechanics. Then the architect-level analysis: what it costs, when it is the wrong choice, and how a customer-facing bank portal or a trading UI actually uses it. React comparisons are drawn against the sibling module **21**. Links in **References**.

---

## Q1. What is Angular, and how is its architecture different from a library like React?

**Per angular.dev:** Angular is *"a web framework that empowers developers to build fast, reliable applications"* — and the word that matters is **framework**, not library.

**The distinction, made concrete:**

| Concern | Angular (framework) | React (library) |
|---|---|---|
| Routing | First-party (`@angular/router`), versioned with the core | You choose React Router / TanStack Router / a meta-framework |
| HTTP | First-party (`HttpClient`), interceptors, XSRF built in | `fetch` / axios / TanStack Query — your call |
| Forms | First-party, two full systems (reactive + template) | Formik / React Hook Form / hand-rolled |
| DI | First-party hierarchical injector | Context + props, or a container library |
| Build / CLI | `ng` — build, test, lint, schematics, `ng update` | Vite / a meta-framework / your own config |
| Language | TypeScript, non-negotiable | TypeScript optional (though near-universal) |
| Release model | One version number for the whole stack, 6-month cadence | Each library versions independently |

**The architect's reading.** Angular trades flexibility for **decision elimination and long-term coherence**. Every Angular team on the planet structures an app roughly the same way, so a new hire is productive in days and an internal platform team can standardise across 40 apps. The cost is that you inherit Angular's opinions whether they fit or not, the runtime is larger, and the framework's release cadence becomes *your* upgrade cadence.

**Where this wins:** large organisations with many long-lived line-of-business apps and rotating staff — exactly the shape of a bank's internal application estate. **Where it loses:** a small team shipping one product fast, or a UI with unusual rendering needs that fights the framework. Saying "we picked Angular because we have 30 apps and 6 squads and we need them to look and build the same" is a stronger answer than "Angular is better."

---

## Q2. Angular vs React — how do you actually choose, at organisation scale?

Not on benchmarks — modern Angular and React are both fast enough that rendering performance is almost never the deciding factor. Choose on **organisational fit and total cost of ownership**.

**Choose Angular when:**
- You have **many apps and many teams** and want one enforced structure, one CLI, one upgrade path, one training curriculum.
- You want **batteries included and supported** — router, forms, HTTP, i18n, testing, SSR all from one vendor on one version line.
- Your developers come from a **strongly-typed, OO background** (C#/Java) — Angular's DI, decorators and class-based services feel native to them.
- You need **strong conventions** because contractors and rotation are a fact of life.

**Choose React when:**
- You want **maximum flexibility** and a team senior enough to assemble and own a stack.
- You need the **largest ecosystem and hiring pool** — React's talent market is several times larger.
- You are betting on **React Server Components / streaming** via Next.js as a first-class rendering strategy.
- The product is **one focused application** where a curated, minimal stack beats a general-purpose framework.

**The honest trade-off table:**

| Dimension | Angular | React |
|---|---|---|
| Onboarding a new hire to *this* codebase | Fast — it looks like every Angular app | Slower — every React app is bespoke |
| Upgrades | `ng update` runs code-mod schematics; predictable | You own N libraries' changelogs |
| Ceiling on customisation | Lower | Higher |
| Bundle floor | Higher (framework runtime) | Lower (add only what you use) |
| Hiring pool | Smaller, but stable | Much larger |
| Decision fatigue | Near zero | Constant |

**Anti-pattern:** letting each squad pick per project so you end up running both at scale — now you pay two ecosystems' upgrade tax, maintain two component libraries, and can't move engineers between teams. Pick one as the default and require a written exception to deviate.

---

## Q3. What are standalone components, and why did Angular move away from NgModules?

**Per angular.dev:** *"Standalone components provide a simplified way to build Angular applications. Standalone components, directives, and pipes aim to streamline the authoring experience by reducing the need for `NgModule`s."* A standalone component declares its own template dependencies directly:

```ts
@Component({
  selector: 'app-trade-blotter',
  imports: [CommonModule, TradeRowComponent, CurrencyPipe],   // deps declared here, not in a module
  template: `@for (t of trades(); track t.id) { <app-trade-row [trade]="t" /> }`,
})
export class TradeBlotterComponent { trades = input.required<Trade[]>(); }
```

**Why NgModules were a problem:**
- **Indirection.** To understand what a component could use, you had to read a separate `@NgModule` file and trace `declarations`, `imports`, `exports`.
- **Boilerplate.** Every feature needed a module; shared things ended up in a `SharedModule` grab-bag that broke tree-shaking.
- **A hard mental model** for newcomers — "why does my component say it doesn't know `MatButton` when I imported the module three files away?"

**Timeline:** standalone APIs arrived in **v14**, became stable in **v15**, became the `ng new` default in **v17**, and from **v19** `standalone: true` is implicit (you now write `standalone: false` to opt *into* an NgModule). NgModules remain supported — Angular has committed to not breaking them — but they are legacy.

**Architect's guidance:** all new code is standalone. For a large existing NgModule app, migrate incrementally with the official schematic (`ng generate @angular/core:standalone`), which runs in stages (convert declarations → remove NgModules → bootstrap standalone). Don't do a big-bang rewrite; the migration is designed to be applied module-by-module behind normal delivery.

---

## Q4. Explain Angular's change detection. What does Zone.js do, and why is Angular moving to "zoneless"?

**The classic model:**
1. **Zone.js** monkey-patches every async browser API — `setTimeout`, `addEventListener`, `Promise.then`, `XHR`. When any of them fires, Zone.js tells Angular *"something might have changed."*
2. Angular then runs **change detection**: it walks the component tree **top-down**, re-evaluates every template binding, and updates the DOM where a bound value's reference changed.

That is *dirty checking* — Angular doesn't know *what* changed, only that a turn of the event loop completed, so it re-checks everything.

**`ChangeDetectionStrategy.OnPush`** prunes that walk. An `OnPush` component is only re-checked when: an `@Input()` **reference** changes, an event fires inside it, an `async` pipe emits, or a **signal read in its template** changes. On a dense screen — a 500-row trade blotter ticking several times a second — `OnPush` everywhere is the difference between a smooth grid and a janky one.

**Why zoneless:**

| Zone.js cost | Consequence |
|---|---|
| ~13 KB runtime, loaded before anything | Slower startup |
| Patches globals | Breaks with some 3rd-party libs; confusing stack traces; interferes with native `async/await` |
| "Something changed" → check *everything* | Wasted work; forces `OnPush` discipline everywhere |

**Signals fix the root cause:** a signal read in a template registers a precise dependency, so a change marks exactly the affected component views dirty instead of triggering a global "something might have happened" sweep. That is what makes dropping Zone.js possible.

**Where zoneless actually stands — get the timeline right, it has moved fast:** `provideExperimentalZonelessChangeDetection` landed in **v18**; **v20** promoted it to developer preview under its final name `provideZonelessChangeDetection()`; **v21 made zoneless stable and the default for new applications**. Zone.js is now opt-in legacy, not the baseline. If you answer "zoneless is an experiment Angular is exploring," you are describing 2024.

**The precision nuance a panel at this bar will probe, and most candidates overstate:** Angular signals are **not** fine-grained DOM reactivity in the Solid/Svelte sense. A signal change marks the **component view** dirty and Angular re-evaluates *that view's* bindings — it does not surgically update the single text node bound to that value. That is a vast improvement on a global tree walk, but "signals update just the one DOM node" is wrong. Truly fine-grained, signal-based components are a stated roadmap direction, not today's runtime behaviour. Saying this unprompted separates someone who has read the design docs from someone who has read a conference summary.

**Architect's position for an existing app:** the target is signal-based, `OnPush`-clean components — then zoneless is a provider swap plus a test pass, not a rewrite. Audit specifically for what breaks: state mutated from `setTimeout` or a third-party callback that silently relied on Zone to trigger CD (now needs a signal write or an explicit `markForCheck`), `fakeAsync`/`tick` tests that depend on zone semantics, and any library that patches or assumes Zone. Run both modes in CI through the transition rather than flipping in one release.

---

## Q5. What are signals, and when do you use a signal instead of RxJS?

**Per angular.dev:** *"A signal is a wrapper around a value that notifies interested consumers when that value changes."* Three primitives:

```ts
const qty   = signal(10);                       // writable
const price = signal(1.25);
const total = computed(() => qty() * price());   // derived, memoised, lazily recomputed
effect(() => console.log('total is', total()));  // side effect, re-runs when deps change
qty.set(20);                                     // total recomputes; effect re-runs
```

**Why they were added.** Angular needed a reactivity primitive it could **track precisely**, so change detection could stop guessing and Zone.js could be removed (Q4). Signals are *synchronous*, *always hold a current value*, *cannot error or complete*, and have *no subscription to leak* — which makes them the right tool for **component state**. (Mind the granularity caveat in Q4: a signal change invalidates a component view, not an individual DOM node.)

**Signals vs RxJS — the decision:**

| Use a **signal** for… | Use an **Observable** for… |
|---|---|
| Component/UI state (`selectedRow`, `isPanelOpen`, `filterText`) | Events over time — WebSocket ticks, `valueChanges`, router events |
| Derived values (`computed`) | Async pipelines needing `debounceTime`, `switchMap`, `retry`, `combineLatest` |
| Template bindings you want CD to track precisely | HTTP calls (`HttpClient` returns Observables) and cancellation |
| Passing reactive inputs (`input()`, `model()`) | Anything that must be *cancelled* or *time-sliced* |

**Interop, not either/or:** `toSignal(observable$)` and `toObservable(signal)` from `@angular/core/rxjs-interop` bridge the two. A common production shape: a WebSocket price feed is an Observable, `toSignal` turns the latest value into a signal, and the template and `computed` P&L work off the signal.

**Know the API's maturity precisely — it's a fast-moving surface and vagueness here reads as second-hand knowledge:** `signal`, `computed`, `effect`, `input()`, `output()`, `model()` and `linkedSignal` are **stable**. `resource()` / `httpResource()` — signal-native async loading with request cancellation and a bindable `status` — are **still developer preview**. They are the intended replacement for a lot of "fetch in `ngOnInit`, stuff the result in a signal" glue, and they are worth prototyping with, but don't put a regulated critical path on a preview API.

**Common mistake candidates make:** claiming signals "replace RxJS." They replace RxJS *for state*. They do not replace RxJS for *streams and coordination* — and `HttpClient`, the router and reactive forms are still Observable-based.

---

## Q6. Where does RxJS still belong in a modern Angular app?

Signals took over state; RxJS keeps the jobs it was always best at — **asynchronous streams and their composition**.

**Still RxJS, and rightly so:**
- **HTTP** — `HttpClient` returns `Observable`s; you get cancellation (unsubscribe aborts the request), retry with backoff, and timeout for free.
- **Typeahead / search** — the canonical `valueChanges.pipe(debounceTime(300), distinctUntilChanged(), switchMap(q => api.search(q)))`. `switchMap` cancelling the stale request is the whole reason this pattern exists; signals have no equivalent.
- **Real-time feeds** — market data, order updates, notifications over WebSocket/SSE: naturally a stream, often needing `bufferTime`, `throttleTime`, `scan` to fold updates.
- **Coordinating multiple async sources** — `combineLatest`, `forkJoin`, `withLatestFrom` to gate an action on several inputs.
- **Router** — `ActivatedRoute.params`, `queryParams`, `NavigationEnd` events.

**Guidance for teams:**
- Keep RxJS **at the edges** (data access, gateways) and expose **signals to components** via `toSignal`. Components stay simple; the streaming complexity is contained and testable.
- Kill subscription leaks structurally: prefer the `async` pipe, `toSignal`, or `takeUntilDestroyed()` — never a hand-managed `Subscription` field that a future edit forgets to unsubscribe.
- Don't reach for a 6-operator pipe when a `computed` will do. Over-using RxJS for plain derived state is the pre-signals anti-pattern that made Angular feel heavy.

---

## Q7. Explain Angular's dependency injection system.

**Per angular.dev:** *"Dependency injection, or DI, is one of the fundamental concepts in Angular. DI is wired into the Angular framework and allows classes with Angular decorators… to configure dependencies that they need."*

**The mechanics:**
- A **provider** tells an injector how to create a value (a class, `useClass`, `useValue`, `useFactory`, `useExisting`).
- **Injectors form a hierarchy.** There is a root `EnvironmentInjector` (application-wide), optional route-level environment injectors, and an `ElementInjector` per component. Resolution walks **up** the tree until a provider is found.
- You request a dependency by **constructor parameter** or, since v14, the **`inject()` function**:

```ts
@Injectable({ providedIn: 'root' })          // tree-shakable app-wide singleton
export class FxRateService {
  private http = inject(HttpClient);
  getRate(ccy: string) { return this.http.get<Rate>(`/api/fx/${ccy}`); }
}
```

**Things an architect must get right:**
- **`providedIn: 'root'`** is the default and the right one — it's a singleton *and* tree-shaken away if unused. Providing a service in a component instead gives every instance of that component its own copy (sometimes what you want — a per-dialog form state service).
- **`InjectionToken<T>`** for anything that isn't a class — config objects, feature flags, base URLs. Don't inject string literals.
- **`inject()` unlocks functional patterns** — functional route guards, resolvers and HTTP interceptors are just functions that call `inject()`, no class needed.
- **Testing** is the payoff: `TestBed.configureTestingModule({ providers: [{ provide: FxRateService, useValue: fake }] })` swaps any dependency. If a class `new`s its collaborators instead of injecting them, it isn't unit-testable — that's the review comment.

---

## Q8. New built-in control flow (`@if` / `@for` / `@switch`) vs the old structural directives — what changed, and why does it matter?

**Old:** `*ngIf`, `*ngFor`, `*ngSwitch` — structural *directives*, shipped in `CommonModule`, each desugaring to an `<ng-template>` and carrying directive-instantiation overhead.

**New (stable since v17):** `@if`, `@for`, `@switch` are **compiler-level syntax** — part of the template language, no import required:

```html
@if (account(); as acct) {
  <app-balance [value]="acct.balance" />
} @else {
  <app-empty-state />
}

@for (txn of transactions(); track txn.id) {         <!-- track is MANDATORY -->
  <app-txn-row [txn]="txn" />
} @empty {
  <p>No transactions in this period.</p>
}
```

**Why it matters:**

| | Old `*ngFor` | New `@for` |
|---|---|---|
| `trackBy` | Optional, silently defaults to identity → full DOM re-create on every list swap | **`track` is required** by the compiler — the performance footgun is closed by design |
| Type narrowing | Weak (`*ngIf="x as y"` narrowing was limited) | Full — `@if (x(); as y)` narrows `y` properly |
| Runtime | Directive instances + `ng-template` | Generated instructions; docs cite ~90% smaller runtime for the control-flow code and a measurable list-rendering speed-up |
| Import | Needs `CommonModule` | Built in |

**Migration:** `ng generate @angular/core:control-flow` rewrites the whole codebase automatically. There is no reason not to do it. **The one thing to check afterwards:** every migrated `@for` got a sensible `track` — the schematic uses `$index` or identity as a fallback, and for lists of objects you want `track item.id`.

---

## Q9. Reactive forms vs template-driven forms — which, and when?

| | **Reactive forms** | **Template-driven forms** |
|---|---|---|
| Source of truth | The `FormGroup`/`FormControl` tree in the component (TypeScript) | The template + `[(ngModel)]` |
| Setup | Explicit — you build the model | Implicit — Angular builds it from directives |
| Validation | Synchronous/async validator functions, composable | Directives in the template |
| Dynamic fields (add/remove controls at runtime) | Natural (`FormArray`, `addControl`) | Awkward |
| Testability | High — assert on the model, no DOM needed | Lower — needs the rendered template |
| Typing | **Strictly typed** since v14 | Loosely typed |

**Architect's rule:** **reactive forms for anything non-trivial** — a payment form, an onboarding wizard, a trade-ticket with cross-field rules and conditional sections. Template-driven is acceptable only for a search box or a single-field filter, and even then reactive is barely more code.

**What separates a good answer:**
- **Cross-field validation** belongs on the `FormGroup`, not smeared across fields — e.g. "settlement date must be ≥ trade date" is a group validator.
- **Typed forms** (`FormGroup<{ amount: FormControl<number>; ccy: FormControl<Currency> }>`) catch a whole class of bugs at compile time; `nonNullable: true` or `FormBuilder.nonNullable` avoids the `T | null` noise.
- **Async validators** (server-side "is this IBAN valid / this account reachable") return an Observable and should be debounced.
- Keep the form model and the API DTO **separate**, with an explicit mapping — the shape the user edits is rarely the shape the backend wants, and coupling them makes both hard to change.
- **Signal Forms** shipped as **experimental in v21** — a signal-native model (a `form()` built over a signal data model, schema-based validation, field state exposed as signals) intended to eventually supersede reactive forms. Know it exists and where it is heading; **do not build a regulated production form on an experimental API**. The hedge that costs nothing today: keep the **validation rules and the form↔DTO mapping as plain functions and types independent of the forms API**, so a future migration is rewiring, not re-deriving the business rules. That is the same reasoning that keeps domain logic out of EF Core (Module 12 Q2) — applied to the frontend.

---

## Q10. How does routing and lazy loading work? What are functional guards, resolvers and interceptors?

**Configuration** is a tree of `Route` objects registered with `provideRouter(routes)`:

```ts
export const routes: Routes = [
  { path: '', component: DashboardComponent },
  {
    path: 'payments',
    loadComponent: () => import('./payments/payments.page')      // lazy: its own JS chunk
      .then(m => m.PaymentsPage),
    canActivate: [authGuard],                                    // functional guard
    resolve: { limits: paymentLimitsResolver },                  // data before activation
  },
  { path: 'admin',
    loadChildren: () => import('./admin/admin.routes').then(m => m.ADMIN_ROUTES) },
];
```

**Lazy loading** is the primary bundle lever: `loadComponent` / `loadChildren` make the router fetch that route's code only when navigated to. Pair with `withPreloading(PreloadAllModules)` or a custom strategy to warm likely-next routes after the app is interactive.

**Functional providers** (the modern form — class-based guards were deprecated in v15.2):

```ts
export const authGuard: CanActivateFn = (route, state) => {
  const auth = inject(AuthService);
  return auth.isLoggedIn() || inject(Router).createUrlTree(['/login']);
};

export const authInterceptor: HttpInterceptorFn = (req, next) =>
  next(req.clone({ setHeaders: { Authorization: `Bearer ${inject(TokenStore).access()}` } }));
```

They are plain functions using `inject()` — less ceremony, trivially testable, composable.

**Architect notes:**
- **Guards enforce navigation, not security.** The API must independently authorise every request — a guard only stops the *UI* from routing. Saying this unprompted is the senior signal.
- **Resolvers** avoid the "page renders, then pops in data" flicker, but they also *delay* the route transition — use them for small, must-have data; stream the rest.
- **`CanDeactivate`** for "you have unsaved changes" on a long form.
- For SSR, **route-level render mode** (v19) lets you mark `/dashboard` as server-rendered and `/admin` as client-only.

---

## Q11. What are `@defer` deferrable views, and what problem do they solve?

**Per angular.dev:** *"Deferrable views… allow you to lazily load parts of your template, including the components, directives, pipes, and any associated CSS."* — declaratively, in the template:

```html
@defer (on viewport; prefetch on idle) {
  <app-fx-exposure-chart [book]="book()" />      <!-- heavy chart lib: charting + d3 -->
} @placeholder (minimum 300ms) {
  <div class="skeleton-chart"></div>
} @loading (after 100ms; minimum 500ms) {
  <app-spinner />
} @error {
  <p>Chart failed to load.</p>
}
```

**The problem it solves.** Before `@defer`, deferring a widget's *code* meant a manual `import()` + `ViewContainerRef` dance, and route-level lazy loading was the only ergonomic split point. `@defer` lets you push an expensive, below-the-fold, or rarely-used component (a chart, a rich-text editor, a map, an analytics panel) **out of the initial bundle** with a one-block template change. The compiler extracts the deferred block's dependencies into a **separate chunk** automatically.

**Triggers:** `on idle` (default), `on viewport`, `on interaction`, `on hover`, `on timer(…)`, `on immediate`, and `when <expr>` for a custom condition. `prefetch` runs the download early without rendering.

**Architect's guidance:**
- Best return is on **heavy third-party dependencies** below the fold — that's where the KB come off the critical path.
- `@placeholder` must reserve the right size or you cause **layout shift (CLS)** — a real Core Web Vitals regression.
- With SSR, combine with **incremental hydration** (`@defer (hydrate on viewport)`, v19) so the server renders the content but the client doesn't hydrate/download its JS until needed.
- Don't shatter the app into 50 tiny defer blocks — each is a network request and a spinner; defer the few things that actually cost.

---

## Q12. Explain SSR, hydration and incremental hydration in Angular.

**The rendering options** (`@angular/ssr`, integrated since v17):

| Mode | What the server sends | Use for |
|---|---|---|
| **CSR** | Empty shell + JS | Internal tools behind login where SEO/first-paint don't matter |
| **SSR** | Fully-rendered HTML per request, then hydrate | Public marketing/product pages, SEO, fast first contentful paint |
| **SSG / prerender** | HTML built at deploy time | Content that rarely changes — docs, pricing, disclosures |

**Hydration.** Historically Angular *threw away* the server DOM and re-rendered on the client — a visible flash and wasted work. **Non-destructive hydration** (`provideClientHydration()`, stable v17) instead **reuses the server-rendered DOM**, walking it and attaching event listeners and bindings in place. **Event replay** (`withEventReplay()`, v18) captures clicks that happen before hydration finishes and replays them after, so early taps aren't lost.

**Incremental hydration** (`withIncrementalHydration()`, v19, developer preview) goes further: paired with `@defer (hydrate on …)`, the server renders everything, but the client hydrates a region **only when triggered** (viewport, interaction), and downloads that region's JS then. You get server-rendered HTML everywhere and client JS only where the user actually engages.

**Architect trade-offs:**
- SSR means you now **run and operate a Node server** (or edge functions) — deployment, scaling, memory, and cold starts become your problem. For an internal bank app, CSR is often the correct, cheaper answer.
- SSR code runs in **two environments** — no `window`/`document`/`localStorage` at module load; guard with `afterNextRender`/`isPlatformBrowser`.
- Hydration requires the server and client to render the **same DOM** — non-deterministic templates (`Date.now()`, `Math.random()`) cause hydration mismatch errors.
- Measure the actual win in **LCP/TTFB/INP**, not vibes; SSR helps first paint but can *hurt* TTFB if your data fetching is slow.

---

## Q13. How do you manage state in Angular — services with signals, or NgRx?

**The tiered answer — match the tool to the actual need:**

| Tier | Mechanism | When |
|---|---|---|
| **Local** | Signals in the component | UI state that doesn't outlive the component — panel open, selected tab |
| **Shared, simple** | An `@Injectable({providedIn:'root'})` service holding `signal`s + `computed`, exposing readonly signals | Most feature state — current user, cart, active filter set, a screen's working data |
| **Server cache** | A data service wrapping `HttpClient` + a signal cache, or a library, or `resource()` (experimental) | Remote data with caching/refetch needs |
| **Large, complex, auditable** | **NgRx Store** (Redux-style) or **NgRx SignalStore** | Many features mutating shared state, need time-travel debugging, strict action log, team needs guardrails |

**The signal-service pattern that covers ~80% of apps:**

```ts
@Injectable({ providedIn: 'root' })
export class BlotterStore {
  private _trades = signal<Trade[]>([]);
  readonly trades = this._trades.asReadonly();
  readonly totalNotional = computed(() => this._trades().reduce((s, t) => s + t.notional, 0));

  load(trades: Trade[]) { this._trades.set(trades); }
  add(t: Trade)         { this._trades.update(list => [...list, t]); }
}
```

**When NgRx earns its keep:** genuinely complex cross-cutting state, a large team that benefits from the enforced *actions → reducers → effects → selectors* structure, a regulated context where a **replayable action log** of every state change is a feature, or heavy need for the DevTools time-travel. **NgRx SignalStore** is the modern, lighter-weight option — Redux discipline without the full boilerplate.

**The mistake to avoid:** reaching for NgRx on a 3-screen app because "enterprise apps use NgRx." You get 200 lines of ceremony to store a filter string. Start with signal services; adopt a store when you feel the specific pain it solves.

---

## Q14. How do you approach performance in an Angular app?

**Split it into load-time and runtime, and measure with Lighthouse + the DevTools profiler + `ng build --stats-json` (bundle analysis), not intuition.**

**Load time (get bytes off the critical path):**
- **Route-level lazy loading** — the biggest lever; the initial bundle should be the shell + first screen only.
- **`@defer`** heavy, below-the-fold widgets and their third-party deps.
- **Budgets in `angular.json`** (`budgets`) so CI *fails* when the bundle regresses past a threshold — performance without a gate decays.
- **SSR/SSG** for first-contentful-paint on public pages; **hydration** so that isn't wasted.
- Modern build (esbuild) + **`optimization: true`** for tree-shaking, minification, critical-CSS inlining.

**Runtime (do less work per frame):**
- **`OnPush` everywhere**, or go **zoneless** — stop checking components that didn't change.
- **Signals** for template state so change detection is surgical.
- **`@for` with a correct `track`** — wrong track key = full DOM rebuild on every list update; on a ticking blotter this is the whole ballgame.
- **`NgOptimizedImage`** for `<img>` — lazy loading, `srcset`, priority hints.
- **Virtual scrolling** (`@angular/cdk/scrolling`) for long lists/grids — render the visible window, not 10,000 rows.
- **Pure pipes** over method calls in templates (a method re-runs every CD cycle).
- **`afterNextRender` / `afterRender`** for DOM measurement instead of forcing synchronous layout in lifecycle hooks.

**The fintech-specific one:** a real-time grid getting hundreds of updates/second should **coalesce** them — buffer with RxJS (`bufferTime(100)`), apply a batch, and let virtual scroll + `track` + `OnPush` keep the DOM writes minimal. Repainting per tick is what kills these UIs.

---

## Q15. AOT, strict templates, Ivy and the esbuild/Vite build system — what should an architect know?

**AOT (Ahead-of-Time compilation).** Angular templates are compiled to JavaScript **at build time**, not in the browser. Benefits: no compiler shipped to the client (~⅓ smaller framework payload), template errors caught at build, faster startup, and it **closes a template-injection XSS vector** because templates aren't compiled from strings at runtime. AOT is the default for production and has been the dev default since v12.

**The lever that actually matters here and is routinely left switched off:** `"strictTemplates": true` under `angularCompilerOptions`. AOT plus strict templates type-checks your **templates** at build time — wrong `@Input()` types, misspelled property bindings, `null` passed where a value is required, wrong `$event` types, bad `async` pipe unwrapping. A team running Angular without `strictTemplates` has disabled roughly half of what it is paying the framework for, and the bugs it would have caught surface instead as runtime `undefined` in production. It is the first setting I check in an architecture review. Enabling it on a legacy app is a graded exercise, not a big bang — the sub-flags (`strictNullInputTypes`, `strictDomEventTypes`, `strictAttributeTypes`…) can be turned on one at a time.

**Ivy** (the compiler/runtime, default since v9) is why any of this is possible — locality (a component compiles from its own decorator, no whole-program analysis), real tree-shaking, smaller bundles, and the foundation standalone components and fine-grained invalidation were built on. Treat it as **settled history**: nobody has chosen between Ivy and ViewEngine since 2020. If an interviewer raises it, say exactly that and move the conversation to what is live — strict templates, the build system, and zoneless.

**The build system.** Angular moved from Webpack to an **esbuild + Vite** based `application` builder — default for new apps in **v17**, stable in **v18**, and now the only forward path (the Webpack-based `browser` builder is deprecated):

| | Old (Webpack) | New (esbuild/Vite) |
|---|---|---|
| Cold build | Slow | Much faster (esbuild is Go, massively parallel) |
| Dev server | Webpack Dev Server | **Vite** — near-instant HMR, ES-module dev serving |
| SSR | Bolt-on | First-class in the same builder |

**Architect's takeaways:**
- **Migrate to the `application` builder** — the DX gain (rebuild/HMR speed) compounds across a whole team, and staying on the deprecated Webpack builder eventually blocks an Angular upgrade. The migration is mostly an `angular.json` change (`ng update` includes a schematic for it).
- Check custom Webpack plugins (`@angular-builders/custom-webpack`) — those need an esbuild-plugin equivalent or a rethink, and this is usually the only genuinely hard part of the migration.
- Turn on **`strictTemplates`** and keep **CI build-time** and **bundle-size** as tracked metrics; all three are early-warning signals for architectural drift.

---

## Q16. How do you test an Angular application?

**The pyramid, Angular-specific:**

| Level | Tool | Tests what |
|---|---|---|
| **Unit** | Jasmine/Jest/Vitest + plain instantiation or `TestBed` | Services, pipes, pure functions, signal/`computed` logic — no DOM |
| **Component** | `TestBed` + `ComponentFixture` + **CDK component harnesses** | A component's template behaviour, inputs/outputs, interaction |
| **Integration** | `TestBed` with real child components, faked HTTP (`HttpTestingController`) | A feature slice wired together |
| **E2E** | **Playwright** or Cypress | Full user journeys against a running app |

**What an architect standardises:**
- **`HttpTestingController`** to assert on outgoing requests and stub responses — never hit a real backend in a component test.
- **Component harnesses** (`getHarness(MatSelectHarness)`) instead of poking at DOM internals with `By.css('.mat-whatever')` — harnesses survive Material version bumps; CSS selectors don't.
- **`fakeAsync`/`tick`** or `await fixture.whenStable()` for async; going **zoneless** changes this materially — `fakeAsync` leans on zone semantics, so signal-based tests increasingly need only `await fixture.whenStable()` / `fixture.detectChanges()`. Budget for test churn as part of the zoneless migration (Q4), because this is where most of it lands.
- **The test-runner situation, which has changed recently and candidates get wrong:** Karma was deprecated in **v16** and is being retired; Angular added **experimental Vitest support in v20** and made **Vitest the default/recommended unit-test runner from v21** (`ng new` scaffolds it). For a new app: Vitest. For an existing Karma/Jasmine suite: migrate deliberately — the assertion style is close, but `TestBed` bootstrapping, zone-dependent async helpers and any Karma-specific config all need work.
- **Accessibility is a test level, not polish.** Run `axe` in CI — `@axe-core/playwright` for e2e, `vitest-axe`/`jest-axe` at component level. In a bank this is a **legal** obligation, not a nice-to-have: **WCAG 2.2 AA** is the reference standard, and the **European Accessibility Act** became enforceable in **June 2025** for consumer-facing financial services in the EU (with equivalent pressure from the ADA in the US and public-sector rules elsewhere). Two things to say honestly: automated checks catch only ~30–40% of real issues, so pair them with periodic manual and screen-reader audits; and Angular CDK's **a11y package** (`LiveAnnouncer`, `FocusTrap`, `cdkTrapFocus`) is the right primitive layer rather than hand-rolling focus management in every dialog.
- **Don't over-test the framework.** Testing that `@if` hides an element is testing Angular. Test *your* logic, *your* branching, *your* edge cases.
- **CI gates:** coverage threshold, `ng lint`, `strictTemplates` typecheck, bundle budget, an `axe` pass, and a Playwright smoke suite on the critical flow (for a payments app: "can a user complete a payment").

---

## Q17. How does Angular protect against XSS, and what are the escape hatches to watch in review?

**Per angular.dev:** *"Angular treats all values as untrusted by default. When a value is inserted into the DOM from a template binding… Angular sanitizes and escapes untrusted values."*

**What you get for free:**
- **Contextual auto-sanitization.** Interpolation (`{{ }}`) escapes HTML. `[innerHTML]="x"` runs `x` through the HTML sanitizer (strips `<script>`, `onerror=`, `javascript:` URLs). URL, style and resource-URL contexts are sanitized to their own rules.
- **AOT compilation** removes runtime template compilation, closing template-injection.
- **Built-in XSRF protection** in `HttpClient` — it reads the `XSRF-TOKEN` cookie and sends it as the `X-XSRF-TOKEN` header on mutating requests (`withXsrfConfiguration`).
- **Trusted Types** — Angular supports a strict CSP `require-trusted-types-for 'script'` policy.

**The escape hatches — every one is a code-review flag:**

| API | Risk |
|---|---|
| `DomSanitizer.bypassSecurityTrustHtml / Style / Url / ResourceUrl / Script` | You are telling Angular "trust this" — if the input is attacker-influenced, it's a straight XSS/`javascript:`-URL hole |
| `[innerHTML]` with server-supplied rich text | Sanitized, but sanitization ≠ zero risk; prefer rendering structured content |
| `<iframe [src]>`, `<object>`, dynamic `<script src>` | `bypassSecurityTrustResourceUrl` is required and is dangerous with any dynamic input |
| `document`, `ElementRef.nativeElement` direct DOM writes | Bypass Angular's sanitizer entirely |

**Architect's controls:** a lint rule banning `bypassSecurityTrust*` outside an allowlisted, reviewed module; a **strict CSP** (`script-src 'self'`, no `unsafe-inline`, ideally Trusted Types); rich text sanitized **server-side too** (defence in depth); and tokens kept out of `localStorage` — an **httpOnly, Secure, SameSite cookie** so an XSS bug can't exfiltrate the session. And remember the constant: **the frontend cannot enforce authorization** — the API must re-check every request.

---

## Q18. How would you do micro-frontends with Angular?

**The two mechanisms:**

| Approach | How | Notes |
|---|---|---|
| **Webpack Module Federation** | `@angular-architects/module-federation` — a host app loads remotely-built Angular bundles at runtime, sharing `@angular/*` as singletons | Mature, but tied to the Webpack builder |
| **Native Federation** | `@angular-architects/native-federation` — same model, **bundler-agnostic**, uses browser-native **import maps**; works with the esbuild `application` builder | The forward path now that Angular has moved off Webpack |
| **Route-level composition** | A thin shell app that routes to independently-deployed Angular apps (iframe or hard nav) | Crude but bulletproof isolation; good for "one team's section is totally separate" |

**Angular-specific hazards an architect must plan for:**
- **Shared framework singletons.** Two Angular versions loaded together, or two copies of `@angular/core`, breaks DI and change detection. You must pin and share the framework version across all remotes — which **couples their upgrade cadences**, partly defeating the point.
- **Runtime weight.** Each remote drags Angular runtime unless sharing is perfect; the shared-dependency config is fiddly and a frequent source of production-only bugs.
- **Design system** must be a separately-versioned shared library or every remote reships it.

**Architect's honest take:** micro-frontends solve an **organisational** problem — many teams needing to deploy one app independently — at a real **technical cost**. Angular's opinionatedness and heavy shared runtime make MFE *heavier* with Angular than with React. Only do it when you genuinely have that many independent teams; a **well-modularised monorepo (Nx) with enforced boundaries** gets you most of the isolation benefit with far less operational pain. Start there; graduate to MFE only when independent *deployment* — not just independent *code* — is the actual constraint.

---

## Q19. How do you run Angular at enterprise scale (monorepo, Nx, module boundaries)?

**The de facto answer is Nx.** An Nx workspace holds many apps and many libraries in one repo with tooling that keeps it sane:

- **Library-first architecture.** Apps are thin; features live in libraries typed by role — `feature-*`, `ui-*` (dumb components), `data-access-*` (state + HTTP), `util-*`. A screen is composed from libraries, not from a pile of folders.
- **Enforced module boundaries.** Nx's `@nx/enforce-module-boundaries` lint rule uses tags (`scope:payments`, `type:feature`) to make illegal imports a **build failure** — `payments` can't import from `onboarding`'s internals; a `ui` lib can't import `data-access`. This is how you stop a monorepo decaying into a big ball of mud.
- **Affected commands.** `nx affected -t build test lint` builds/tests only what a change actually touches — essential when the repo has 40 apps.
- **Computation caching** (local + remote/Nx Cloud) — never rebuild or retest an unchanged project; CI drops from hours to minutes.
- **Generators** enforce structure — `nx g lib` scaffolds a library the house way, so 200 libraries stay consistent.

**Architect's guidance:**
- Decide the **tagging taxonomy up front** (`scope` = business domain, `type` = layer) and write the boundary rules on day one — retrofitting them onto a messy repo is painful.
- Keep a **published, versioned design-system library** as the single source of UI truth.
- A monorepo with strong boundaries is the **lower-risk alternative to micro-frontends** for most orgs (Q18): you get independent code ownership and enforced isolation without N deploy pipelines and runtime-integration bugs.
- The trade-off: everyone is on **one version of everything**, and upgrades are all-or-nothing across the repo — which is a feature (no version drift) and a constraint (no team can lag).

---

## Q20. What is your upgrade and long-term-maintenance strategy for Angular?

**Angular's release model** is the thing to design around: a **major every ~6 months**, each supported ~18 months (6 months active + 12 months LTS). Skipping majors is not supported — you upgrade one major at a time.

**The strategy:**
1. **Stay at most one major behind, always.** The longer you defer, the more breaking changes and dependency conflicts stack up, and the bigger the eventual forced migration when a security fix lands only on a supported version.
2. **Lean on `ng update`.** It runs **migration schematics** that rewrite your code for breaking changes automatically (standalone migration, control-flow migration, `inject()` migration, RxJS API changes). Review the diff, run the tests, ship. Use the official interactive guide at `angular.dev/update-guide`.
3. **Gate upgrades in CI** — a canary branch that runs `ng update` and the full test + e2e suite, so you know the blast radius before committing the team.
4. **Budget it as routine work**, ~2 planned upgrade cycles a year, not a "project." Teams that treat upgrades as optional accrue a migration debt that eventually needs a quarter to clear.
5. **Keep third-party Angular libraries minimal and well-chosen** — an abandoned component library that doesn't support the next major will pin your whole app. Vet libraries for release history before adopting.
6. **Modernise opportunistically as you go**, roughly in this order of value-per-risk: `strictTemplates` → the `application` builder → standalone → new control flow → signals → zoneless → Vitest. Each is individually low-risk and most have a schematic; doing them incrementally is what prevents a future big-bang. The ordering matters — strict templates and the builder migration are cheap and de-risk everything after them, whereas zoneless is best attempted only once components are signal-based and `OnPush`-clean (Q4).

**The thing to say that most candidates don't:** the upgrade treadmill is a **real, quantifiable cost of choosing Angular**, and an architect owns it explicitly rather than discovering it. Two majors a year across an estate of 40 apps is a standing platform-team commitment. The mitigations are structural, not heroic: a **monorepo** so one upgrade covers everything at once (Q19), a **thin, well-vetted third-party surface**, and a shared **design-system library** that absorbs framework churn on behalf of every app. Teams that skip those pay the tax per-app, forever.

**On legacy AngularJS (1.x):** it reached end-of-life in January 2022. Any remaining AngularJS should be on a funded migration path — `ngUpgrade` hybrid mode to run both side-by-side and convert route-by-route, or a strangler-fig rewrite. Running unsupported AngularJS in a regulated environment is an audit finding.

---

## References — official documentation

| Topic | Source |
|---|---|
| Angular — What is Angular? / overview | https://angular.dev/overview |
| Angular — Components | https://angular.dev/guide/components |
| Angular — Standalone components | https://angular.dev/guide/components/importing |
| Angular — Migrate to standalone | https://angular.dev/reference/migrations/standalone |
| Angular — Signals | https://angular.dev/guide/signals |
| Angular — `linkedSignal` / `resource` | https://angular.dev/guide/signals/resource |
| Angular — RxJS interop (`toSignal` / `toObservable`) | https://angular.dev/ecosystem/rxjs-interop |
| Angular — Zoneless change detection | https://angular.dev/guide/zoneless |
| Angular — `ChangeDetectionStrategy.OnPush` | https://angular.dev/best-practices/runtime-performance |
| Angular — Dependency injection | https://angular.dev/guide/di |
| Angular — `inject()` function | https://angular.dev/api/core/inject |
| Angular — Control flow (`@if` / `@for` / `@switch`) | https://angular.dev/guide/templates/control-flow |
| Angular — Control-flow migration | https://angular.dev/reference/migrations/control-flow |
| Angular — Reactive forms | https://angular.dev/guide/forms/reactive-forms |
| Angular — Typed forms | https://angular.dev/guide/forms/typed-forms |
| Angular — Forms overview (incl. experimental Signal Forms) | https://angular.dev/guide/forms |
| Angular — Routing & navigation | https://angular.dev/guide/routing |
| Angular — Route-level guards (`CanActivateFn`) | https://angular.dev/api/router/CanActivateFn |
| Angular — HTTP interceptors (`HttpInterceptorFn`) | https://angular.dev/guide/http/interceptors |
| Angular — Deferrable views (`@defer`) | https://angular.dev/guide/defer |
| Angular — Server-side rendering (SSR) | https://angular.dev/guide/ssr |
| Angular — Hydration | https://angular.dev/guide/hydration |
| Angular — Incremental hydration | https://angular.dev/guide/incremental-hydration |
| Angular — Runtime performance / profiling | https://angular.dev/best-practices/runtime-performance |
| Angular — `NgOptimizedImage` | https://angular.dev/guide/image-optimization |
| Angular — CDK virtual scrolling | https://material.angular.io/cdk/scrolling/overview |
| Angular — AOT compiler | https://angular.dev/tools/cli/aot-compiler |
| Angular — Strict template type-checking (`strictTemplates`) | https://angular.dev/tools/cli/template-typecheck |
| Angular — Build system / `application` builder (esbuild) | https://angular.dev/tools/cli/build-system-migration |
| Angular — Testing | https://angular.dev/guide/testing |
| Angular — Component harnesses | https://material.angular.io/cdk/test-harnesses/overview |
| Angular CDK — accessibility utilities (`LiveAnnouncer`, `FocusTrap`) | https://material.angular.io/cdk/a11y/overview |
| Angular — Accessibility guide | https://angular.dev/best-practices/a11y |
| W3C — WCAG 2.2 | https://www.w3.org/TR/WCAG22/ |
| European Accessibility Act — Directive (EU) 2019/882 | https://eur-lex.europa.eu/eli/dir/2019/882/oj |
| Deque — axe-core accessibility testing engine | https://github.com/dequelabs/axe-core |
| Angular — Security (XSS, sanitization, Trusted Types) | https://angular.dev/best-practices/security |
| Angular — HTTP XSRF/CSRF protection | https://angular.dev/guide/http/security |
| Angular — Update guide (version migrations) | https://angular.dev/update-guide |
| Angular — Roadmap & release practices | https://angular.dev/roadmap |
| Angular blog — release announcements (v17 control flow/`@defer`/esbuild → v21 zoneless + Vitest defaults) | https://blog.angular.dev/ |
| Nx — Angular monorepo | https://nx.dev/getting-started/intro |
| Nx — Enforce module boundaries | https://nx.dev/features/enforce-module-boundaries |
| Native Federation / Module Federation for Angular | https://www.angulararchitects.io/en/blog/the-microfrontend-revolution-module-federation-in-angular/ |
| NgRx — Store & SignalStore | https://ngrx.io/guide/store |
| RxJS — operators & guides | https://rxjs.dev/guide/operators |
| MDN — Content Security Policy | https://developer.mozilla.org/docs/Web/HTTP/CSP |
| web.dev — Core Web Vitals | https://web.dev/articles/vitals |

---

**Previous:** [19 — AI / RAG](./19-AI-RAG.md) | **Next:** [21 — React](./21-React.md)
