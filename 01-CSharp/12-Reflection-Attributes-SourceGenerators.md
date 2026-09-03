# Module — C# Advanced: Reflection, Attributes, Metaprogramming & Source Generators

> Domain: C# | Level: Beginner → Expert | Prerequisite: [[01-CLR-JIT-GC-Memory-Management]] (assembly loading, JIT, NativeAOT), [[06-Generics-Variance]] (runtime generic instantiation), [[05-LINQ-Internals]] (expression trees as data)

---

## 1. Topic Description

### Definition

**Reflection** is the runtime inspection and invocation of types and members through metadata the CLR retains in every assembly — the same reification that makes generics work. **Attributes** are declarative metadata attached to code elements, inert until something reads them. **Metaprogramming** is code that produces or drives other code, spanning runtime approaches (reflection, expression trees compiled to delegates, `Reflection.Emit`, dynamic proxies) and compile-time ones. **Source generators** are the compile-time alternative: Roslyn components that inspect the compilation and emit additional C# during the build, producing ordinary code with no runtime cost — which is what makes them the sanctioned replacement for reflection under trimming and NativeAOT.

### Core sub-concepts

- **Metadata and `Type`** — assemblies, `Type`, `MemberInfo`, `MethodInfo`, `PropertyInfo`; `typeof` versus `GetType()` and static versus runtime type.
- **Reflection performance** — the cost of member lookup versus invocation, and why `MethodInfo.Invoke` is orders of magnitude slower than a direct call.
- **Caching reflection results** — resolving members once, and the correct thread-safe caching pattern for `MakeGenericMethod` and similar.
- **Compiled delegates** — building an `Expression` tree and calling `Compile()` to convert reflection into near-direct-call performance, and `CreateDelegate` for simpler cases.
- **`Reflection.Emit` and dynamic methods** — runtime IL generation, its power and its incompatibility with AOT.
- **Attributes** — definition, `AttributeUsage`, targets, inheritance, positional versus named arguments, and the fact that attributes are metadata not behaviour.
- **Attribute discovery cost** — `GetCustomAttributes` allocating and reflecting on every call, and why it belongs in startup caching not a request path.
- **Assembly loading** — `AssemblyLoadContext`, collectible contexts for plugin unload, load failures and version conflicts.
- **Dynamic proxies and interception** — how AOP libraries generate types at runtime, and what that costs in debuggability and AOT compatibility.
- **`dynamic` and the DLR** — call-site caching, when it is legitimate, and why it defeats every static guarantee.
- **Source generators** — incremental generators, the `ISourceGenerator`/`IIncrementalGenerator` model, analysing the compilation, emitting partial types.
- **Generator design constraints** — determinism, performance in the IDE, incrementality, and debuggability of generated code.
- **Analyzers and code fixes** — the same Roslyn platform used to enforce conventions rather than emit code.
- **Trimming and NativeAOT** — why reflection over types not statically referenced breaks, trim annotations, and the migration from reflection to generation.
- **Choosing the mechanism** — direct code, generics, source generation, cached reflection, expression trees, emit, `dynamic` — in ascending order of cost and risk.

### Where it fits

Reflection is the runtime face of the same metadata that makes generics reified, so it sits alongside `06-Generics-Variance`; expression trees connect it to `05-LINQ-Internals`, where the same "code as data" mechanism drives query translation. Almost every framework a .NET service depends on is built on this layer — DI containers resolving constructors, serialisers mapping properties, ORMs materialising entities, validation and mapping libraries, test frameworks discovering tests, and AOP libraries generating proxies. That ubiquity is why it matters architecturally: the ecosystem's reliance on runtime metadata is precisely what makes trimming and NativeAOT hard, and source generators are the industry's answer.

### Why it matters at scale

Two costs dominate. First, **startup and throughput**: reflection-driven work that runs once at startup is usually fine, but the same code on a request path is orders of magnitude slower than a direct call and allocates on every invocation — a mapping layer using uncached reflection per property per object is a common and entirely invisible tax, because it looks like ordinary code. Assembly scanning at startup multiplies across a fleet of frequently-restarted or scale-to-zero instances into real cost. Second, and increasingly decisive, **deployment options**: any code path that constructs types or closes generics from runtime information cannot be produced ahead of time, so it fails under trimming and NativeAOT — meaning a design choice made years earlier for convenience forecloses a deployment model, and the discovery usually happens mid-migration when it is most expensive.

### Common pitfalls / anti-patterns

- **Reflection on a request path without caching** — `GetProperties`, `GetCustomAttributes` and `MakeGenericMethod` each perform lookup and allocate on every call, so a per-request mapping or validation loop pays hundreds of times what a cached delegate would.
- **`MethodInfo.Invoke` in a hot loop** — orders of magnitude slower than a direct call; the fix is to build and cache a compiled delegate once per target and invoke that.
- **Runtime generic instantiation via `MakeGenericType`/`Activator.CreateInstance`** — cannot be generated ahead of time, so it silently rules out NativeAOT and can fail under trimming with an error far from the cause.
- **Assembly scanning to discover types at startup** — costs measurable startup time per instance, is fragile when assemblies are lazily loaded, and is the primary blocker when a team later wants trimming.
- **Treating attributes as behaviour** — an attribute does nothing until something reflects over it, so a `[Required]` or `[Transactional]` attribute with no component reading it is a comment that looks like a control.
- **Caching reflection results in a non-thread-safe dictionary** — the cache is populated concurrently on first use, so a plain `Dictionary` corrupts under load; and `ConcurrentDictionary.GetOrAdd` may run the expensive factory several times.
- **Using `dynamic` to avoid designing an interface** — every call becomes a runtime binding with no compile-time checking, no refactoring support and no IntelliSense, and errors surface as `RuntimeBinderException` at the call site rather than at build.
- **A source generator that is non-deterministic or slow** — it runs on every keystroke in the IDE, so a generator doing I/O or heavy work makes the editor unusable, and non-deterministic output breaks incremental builds and reproducibility.
- **Generating code that cannot be debugged or inspected** — without emitting the generated files, engineers cannot step through or diagnose behaviour, which turns the generator into a black box nobody will trust.
- **Reaching for reflection where generics or an interface would do** — the most common form is a "generic" helper that inspects types at runtime when a constrained generic method would have been checked at compile time and faster.

---

## 2. Beginner (10 Q&A)

**Q1. This is on a request path. What's the problem?**
```csharp
foreach (var prop in typeof(Order).GetProperties())
    if (prop.GetCustomAttribute<AuditedAttribute>() != null)
        Write(prop.Name, prop.GetValue(order));
```
**A:** Every call re-does the metadata lookup — `GetProperties` and `GetCustomAttribute` both search and allocate — and `GetValue` goes through reflection invocation rather than a direct call. Per request, per property, that's orders of magnitude more than it needs to be. The fix is to build the plan once per type into a cache and, better, compile a delegate per property so the actual access is near-direct. Reflection at startup is fine; reflection per request is a tax nobody sees.
*Follow-up: What's the risk in that caching pattern if you use `ConcurrentDictionary.GetOrAdd`?*

**Q2. What does an attribute do on its own?**
**A:** Nothing. It's metadata stored in the assembly, inert until some component reflects over it and acts. That's why `[Required]` only validates if a validation framework reads it — and why an attribute added in the belief that it enforces something is a genuine hazard: it looks like a control in code review while doing absolutely nothing. Attributes are a declaration mechanism; the behaviour always lives in whatever reads them.
*Follow-up: How would you find out whether a given attribute in a codebase is actually being read?*

**Q3. What's the difference?**
```csharp
void Log(Animal a) {
    Console.WriteLine(typeof(Animal).Name);
    Console.WriteLine(a.GetType().Name);
}
// called with a Dog
```
**A:** First prints `Animal`, second prints `Dog`. `typeof` resolves at compile time from the static type; `GetType()` returns the object's actual runtime type. The distinction matters wherever polymorphism is involved — equality implementations, serialisation and logging all behave differently depending which you use, and picking `typeof` where you meant `GetType()` gives behaviour that's correct for the base case and wrong for every subclass.
*Follow-up: Inside a generic method with a reference-type `T`, what does `typeof(T)` give you?*

**Q4. How do you make reflection fast enough for a request path?**
**A:** Do the reflection once and cache the *result of it* — ideally not the `MemberInfo` but a compiled delegate. Build an expression tree representing the property access or method call, `Compile()` it, and you get a delegate whose invocation approaches a direct call; `Delegate.CreateDelegate` does the same for simpler cases. Key a concurrent cache by type, pay the construction cost once for the process lifetime. That converts an unacceptable per-call cost into a negligible one.
*Follow-up: `Compile()` is expensive and this cache grows. What could go wrong in a plugin host?*

**Q5. What's a source generator, and what problem does it solve?**
**A:** A Roslyn component that runs during compilation, inspects the code being compiled, and emits additional C# compiled alongside it. It solves what reflection solves — code that adapts to types you didn't hand-write — but at build time, so the output is ordinary code: no runtime lookup, no allocation, fully debuggable, and AOT-compatible. That's why serialisation, logging, DI registration and mapping have all been moving to generators.
*Follow-up: What can a generator *not* do that reflection can?*

**Q6. Why does this fail under NativeAOT?**
```csharp
var t = Type.GetType(config.HandlerTypeName);
var closed = typeof(Handler<>).MakeGenericType(t);
var h = Activator.CreateInstance(closed);
```
**A:** AOT compiles everything ahead of time and trimming removes what isn't statically referenced — both need to know what's used at build time. A type resolved by name from configuration and a generic closed from a runtime value are invisible to that analysis, so the code was never generated or was trimmed away, and you get a missing-type error at runtime far from the cause. Annotations can preserve specific members, but only where you can enumerate them, which defeats the open-ended discovery this is usually doing.
*Follow-up: How would you audit an existing codebase for this before committing to AOT?*

**Q7. When is `dynamic` legitimate?**
**A:** Where the shape genuinely isn't known at compile time and there's no reasonable static contract — COM interop, a scripting boundary, a payload whose structure varies per caller. The cost goes beyond performance: no compile-time checking, no refactoring support, no IntelliSense, and errors surfacing as runtime binder exceptions. So confine it to the boundary where the dynamism actually exists and convert to a typed model immediately. Using it to avoid defining an interface trades a design decision for a class of runtime failures.
*Follow-up: The DLR caches call sites. Does that make `dynamic` fast?*

**Q8. What is `AssemblyLoadContext` and why does collectibility matter?**
**A:** It's the isolation and lifetime boundary for loaded assemblies, and a *collectible* context can be unloaded, freeing its assemblies and types. That matters for plugin architectures: without one, every loaded plugin assembly stays for the process lifetime, so a system loading plugins dynamically leaks type and code-heap memory that's never reclaimed. Unloading is conditional though — any lingering reference to a type from that context prevents it, which is why plugin unload is notoriously hard to actually achieve.
*Follow-up: You unload and memory doesn't drop. How would you find what's holding it?*

**Q9. What's a dynamic proxy, and where do you encounter one?**
**A:** A type generated at runtime that implements an interface or subclasses a type, forwarding calls to an interceptor — the mechanism behind AOP-style logging, transactions, caching and lazy loading, and behind most mocking frameworks. It's powerful because it adds behaviour without touching the target, and costly because that behaviour is invisible at the call site, the generated types clutter stack traces, and the runtime code generation is incompatible with AOT.
*Follow-up: Why can a dynamic proxy usually only intercept virtual or interface members?*

**Q10. Analyzers and generators use the same platform. What's the difference in purpose?**
**A:** An analyzer inspects code and reports diagnostics — it enforces conventions and can offer fixes, but doesn't change what's compiled. A generator adds code to the compilation. They pair well: a generator emits the plumbing, and an analyzer enforces the conventions the generator requires, like the type being `partial`. Together they're how a platform team makes the correct pattern automatic and the incorrect one a build error.
*Follow-up: You want to ban a specific API across an organisation. Analyzer, or something else?*

---

## 3. Intermediate (10 Q&A)

**Q1. A mapping layer is the top CPU consumer. How do you approach it?**
**A:** First confirm what it's doing per call — the common finding is uncached reflection, resolving properties and attributes for every object rather than once per type. Fixes in ascending effort: cache per-type metadata; replace `PropertyInfo.GetValue`/`SetValue` with compiled delegates built once per type; or replace the layer entirely with a source-generated mapper, which removes the runtime work. Benchmark with realistic object shapes, since the win scales with property count and volume — and check whether the mapping is needed at all before optimising it.
*Follow-up: The compiled-delegate approach adds startup cost per type. How do you manage that?*

**Q2. What's wrong with this cache?**
```csharp
static readonly ConcurrentDictionary<Type, Func<object,object>> _accessors = new();
var f = _accessors.GetOrAdd(t, BuildExpensiveAccessor);
```
**A:** `GetOrAdd`'s factory can run on several threads at once for the same key, with only one result kept — so you pay the expensive `Compile()` repeatedly and discard the results. Store `Lazy<Func<object,object>>` instead: creating the `Lazy` is cheap and idempotent, and the `Lazy` guarantees the expensive part runs once. Also key on the *runtime* type rather than the declared one, or derived types silently share the base's cached accessor.
*Follow-up: In a plugin host, what's the second problem with this cache?*

**Q3. When would you write a source generator rather than use reflection?**
**A:** When the work is derivable from the code at build time and executed often at runtime — serialisation, mapping, logging, DI registration, strongly-typed configuration. Those give the full benefit: no runtime lookup, no allocation, AOT compatibility, and code you can read and step through. Reflection stays appropriate when the shape genuinely isn't known until runtime, like loading plugins whose types aren't referenced at compile time. The dividing question is simply whether the compiler could have known — if it could, generation is strictly better.
*Follow-up: Your generator needs information from a config file. Still a good fit?*

**Q4. What makes a source generator good or bad to live with?**
**A:** It runs in the IDE on every keystroke, so it must be fast and incremental — an `IIncrementalGenerator` with well-chosen predicates so it doesn't re-run on unrelated edits, and no I/O or network access. It must be deterministic, or builds stop being reproducible and incremental compilation breaks. And the generated code must be inspectable — emitted to disk during development, readable names and structure — because a generator whose output nobody can see becomes an unfixable black box the first time it produces something unexpected. Those three properties decide whether a team keeps it.
*Follow-up: How would you debug a generator producing wrong output for one specific type?*

**Q5. How do you handle assembly scanning in a startup-sensitive service?**
**A:** Replace it with explicit registration, ideally generated. Scanning walks every type in every assembly, costs measurable startup time per instance, is fragile when assemblies load lazily, and is the single most common blocker for trimming. A source generator can emit the same registrations at build time from the same conventions — identical developer ergonomics, none of the runtime cost. Narrowing the scan to specific assemblies helps, but it doesn't remove the AOT problem; only generation does.
*Follow-up: The team values convention-based registration for the developer experience. How do you keep that?*

**Q6. How do you assess whether a codebase can move to NativeAOT?**
**A:** Inventory the runtime-metaprogramming surface: reflection over types resolved by name, `MakeGenericType`/`MakeGenericMethod`, `Activator.CreateInstance` with runtime types, `Reflection.Emit`, dynamic proxies, `dynamic`, and reflection-based serialisation. Then check the dependency graph, because the blockers are usually in libraries rather than your code — an ORM, a mapper, a container's scanning, an AOP framework. The migration is then a series of replacements, mostly to source generators. Produce that inventory *before* committing to AOT publicly, since discovering it mid-migration is what makes these projects overrun.
*Follow-up: One critical library uses `Reflection.Emit` with no AOT-compatible alternative. Options?*

**Q7. What are the risks of interception and AOP in an application architecture?**
**A:** Behaviour becomes invisible at the call site — a method that appears to do one thing is also opening a transaction, logging, checking a cache and retrying, none of which is in the code you're reading. Powerful, and genuinely hard to debug years later, particularly when interception order matters and is defined somewhere else. It also requires runtime type generation, which forecloses AOT. I prefer explicit composition — decorators registered visibly in the composition root — which gives the same cross-cutting behaviour with the ordering and participants visible in one readable place.
*Follow-up: You inherit a system using interception for transactions across 200 services. Do you migrate it?*

**Q8. When are expression trees the right tool?**
**A:** When you need to build behaviour from runtime information but execute it many times — compile once, invoke many, which is why ORMs and mappers use them internally. The costs: `Compile()` is expensive so results must be cached, the compiled code is invisible to a debugger, and — decisively for some architectures — it's runtime code generation, so it doesn't work under AOT. Where the shape is known at compile time, a source generator gives the same performance with none of those limitations.
*Follow-up: How do you cache compiled expressions without the cache becoming a leak?*

**Q9. Generics, reflection or generation for a "works with any type" requirement?**
**A:** In that order of preference. Generics with constraints are checked at compile time, cost nothing at runtime and work everywhere — and they cover more cases than people expect, especially with static abstract interface members. Source generation covers what generics can't, such as per-type serialisers, still with no runtime cost. Reflection is the fallback for genuinely runtime-unknown shapes, cached and confined. The mistake is starting at reflection because it's the most flexible, thereby paying runtime cost and losing AOT for a requirement the type system could have expressed.
*Follow-up: Give me a case where generics genuinely can't express it.*

**Q10. How would you find every place a codebase reflects over attributes on a hot path?**
**A:** Static search for the reflection APIs is the crude first pass — `GetCustomAttribute`, `GetProperties`, `MakeGenericMethod`, `Invoke` — but it over-reports, since startup usage is fine. What actually identifies the problem is a CPU profile under load showing reflection machinery in the hot stacks, plus allocation profiling, since uncached reflection allocates on every call. I'd also check the libraries, because home-grown infrastructure caches this far less often than mature frameworks do.
*Follow-up: How would you verify whether a third-party library caches its reflection?*

---

## 4. Expert / Architect (10 Q&A)

**Q1. How do you set policy on runtime metaprogramming across an estate?**
**A:** Tie it to the deployment strategy, because that's what makes it a real constraint rather than a preference. If AOT or trimming is a strategic goal for any workload class, then reflection-driven type discovery and runtime generic instantiation are banned patterns in that class, with source generation as the sanctioned alternative — and that has to be decided *before* a large codebase exists. Elsewhere the policy is narrower: reflection is fine at startup and in tooling, and needs caching plus justification on request paths. Enforce with analyzers where possible, a documented review trigger where not, since the failure mode is silent.
*Follow-up: Half the estate needs AOT and half doesn't. How do you avoid two incompatible standards?*

**Q2. How would you evaluate introducing a source generator into a shared build?**
**A:** As a build-time dependency the whole organisation now carries, so the bar is ownership and lifecycle: who maintains it, how it's versioned, what happens when the Roslyn API changes, how a broken generator is rolled back — because a generator failure blocks every build, not one service. Technically I'd require incrementality and IDE performance evidence, determinism, emitted output for inspection, and tests over the generator itself. With those, generators are excellent value, trading runtime cost for build-time work. Without them, it becomes the thing everyone's afraid to upgrade.
*Follow-up: The generator's author leaves. What should already be in place?*

**Q3. What's the architectural cost of the ecosystem's reliance on runtime reflection?**
**A:** It made .NET's frameworks enormously productive — DI, ORMs, serialisers and test frameworks all working by convention with no code generation — and deferred a cost now coming due. Trimming, AOT, startup-sensitive serverless and mobile targets all need static knowledge, so the ecosystem is migrating to generators, and applications built deeply on reflection-driven libraries are the ones that can't follow. The lesson is that a runtime-flexibility choice is also a deployment-options choice, and the coupling only becomes visible years later — which is a good argument for preferring the statically-known mechanism when both are available.
*Follow-up: How would you factor that into choosing a library today?*

**Q4. How do you design a plugin architecture that can actually unload plugins?**
**A:** A collectible `AssemblyLoadContext` per plugin, and extreme discipline about references escaping it: any type, delegate or object from the plugin held by the host prevents unload — including event subscriptions, cached `Type` objects, static references and running tasks. So the host interacts with plugins only through interfaces defined in a shared assembly loaded in the default context, and has an explicit teardown that unsubscribes and drains before unloading. Verify unload actually happens with a test that forces collection and asserts the context is gone, because "it should unload" is almost never true first time.
*Follow-up: You need to pass a callback from host into plugin. How do you avoid pinning the context?*

**Q5. How would you migrate a large reflection-based framework to source generation?**
**A:** Incrementally, behind the same public API, so consumers are unaffected: generate for types that opt in, fall back to reflection for the rest, migrate consumers gradually with telemetry showing which path each type takes. That dual-path period is essential, because a big-bang switch on a framework used across an estate is unreviewable. Prioritise by benefit — highest-volume types, and the ones blocking AOT — and keep the reflection path until telemetry shows it's unused rather than until a date passes. The main risk to manage is behavioural divergence between the two paths, which needs a differential test suite.
*Follow-up: The two paths produce subtly different output for one edge case. How do you handle it?*

**Q6. What's your position on convention-over-configuration frameworks at scale?**
**A:** Conventions are excellent while everyone knows them and terrible once they're implicit. Reflection-driven conventions have no compile-time verification, so a renamed method or a missing suffix produces a runtime failure or — worse — silent non-registration, with the failure far from the change. At small scale that's a fine trade for the ergonomics. At large scale I prefer conventions enforced by analyzers and realised by generators, which keeps the developer experience while making violations build errors. A convention nobody can violate accidentally is worth far more than one that's merely documented.
*Follow-up: A team's handler isn't registered and nothing errors. How would you have prevented that class of bug?*

**Q7. How heavily do you weigh the debuggability cost of metaprogramming?**
**A:** Heavily, because it's paid by everyone who maintains the system rather than by the author. Runtime-generated proxies produce stack traces full of synthetic types; expression-compiled delegates can't be stepped into; interception hides behaviour from the call site; reflection-driven wiring means "find all references" doesn't find the caller. Source generation is much better here precisely because the output is real, readable, steppable code. So when comparing mechanisms of equal capability I weight debuggability high — the cost of an undiagnosable 3 a.m. production issue exceeds most of the performance differences being argued about.
*Follow-up: How would you make a generated-code approach genuinely debuggable in production stack traces?*

**Q8. How does metaprogramming interact with security?**
**A:** It's a real attack surface. Reflection reaches private members, so anything relying on `private` for security rather than design isn't protected. Loading assemblies from paths or names influenced by input is a code-execution risk, as is deserialisation resolving types from the payload — the classic RCE pattern across every platform. Runtime code generation from untrusted input is worse still. I'd treat any path where input influences type resolution, assembly loading or member invocation as requiring explicit threat modelling and a closed allow-list rather than open resolution.
*Follow-up: A feature lets users configure a "handler type name". How do you make that safe?*

**Q9. How do you decide whether an abstraction resolves at compile time or runtime?**
**A:** By whether the set of possibilities is closed at build time. If it is — the handlers in this assembly, the serialisable types in this contract, the endpoints in this service — resolve at compile time and get checking, performance, AOT compatibility and navigable code. If it genuinely isn't — plugins deployed independently, tenant-specific extensions, scripting — runtime resolution is the right tool and its costs are the price of the capability. The failure I see most is using runtime resolution for a closed set out of habit, paying every cost for flexibility that's never exercised.
*Follow-up: The set is closed today but the roadmap says plugins next year. What do you build now?*

**Q10. What separates an excellent answer from an adequate one on metaprogramming?**
**A:** An adequate answer knows reflection is slow and should be cached. An excellent one places the mechanisms on a spectrum — direct code, generics, source generation, cached delegates, reflection, emit, `dynamic` — and picks the *least powerful* one that solves the problem, because power here is paid for in checking, performance, debuggability and deployment options. It knows which reflection operations cost what, distinguishes startup-once from per-request, treats AOT and trimming compatibility as an architectural constraint rather than a detail, and weighs the maintenance cost of invisible behaviour. The distinguishing quality is treating runtime flexibility as something purchased deliberately rather than assumed free.
*Follow-up: Where on that spectrum would you place a DI container's constructor resolution, and would you change it?*

---
