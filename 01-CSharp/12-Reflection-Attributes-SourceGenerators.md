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

**Q1. What makes reflection possible in .NET, and what does that cost?**
**A:** Every assembly carries full metadata describing its types and members, which the CLR needs anyway for JIT, type loading and reified generics — reflection is the API that exposes it. The cost is that reflection operations are lookups against that metadata rather than direct calls: finding a member involves searching and allocating `MemberInfo` objects, and invoking through `MethodInfo` goes through argument boxing and security checks rather than a direct call instruction. That difference is negligible once at startup and severe in a loop.
*Follow-up: Roughly what's the difference in magnitude between a direct call and `MethodInfo.Invoke`?*

**Q2. What is an attribute, and what does it do on its own?**
**A:** Nothing. An attribute is metadata attached to a code element and stored in the assembly; it has no behaviour until some component reflects over it and acts. That is why `[Required]` only validates if a validation framework reads it, and why an attribute added in the belief that it enforces something is a genuine hazard — it looks like a control in code review while doing nothing. The corollary is that attributes are a *declaration* mechanism, and the behaviour always lives in the component that reads them.
*Follow-up: How would you find out whether a given attribute in a codebase is actually being read by anything?*

**Q3. What is the difference between `typeof(T)` and `obj.GetType()`?**
**A:** `typeof` is resolved at compile time from the static type and produces a `Type` for exactly that type. `GetType()` is a runtime call returning the object's *actual* runtime type, which for a variable declared as a base type or interface is the derived type. The distinction matters wherever polymorphism is involved — equality implementations, serialisation and logging frequently behave differently depending on which one is used, and using `typeof` where `GetType()` was meant produces behaviour that is correct for the base case and wrong for every subclass.
*Follow-up: Inside a generic method, what does `typeof(T)` give you when `T` is a reference type and the code body is shared?*

**Q4. How do you make reflection fast enough for a request path?**
**A:** Do the reflection once and cache the result of it — ideally not the `MemberInfo` but a *compiled delegate*. Building an expression tree that represents the property access or method call and calling `Compile()` produces a delegate whose invocation cost approaches a direct call, and `Delegate.CreateDelegate` does the same for simpler cases. The pattern is to key a concurrent cache by the type (or type-plus-member) and pay the construction cost once per type for the process lifetime. That converts an unacceptable per-call cost into a negligible one.
*Follow-up: What's the risk in that caching pattern if you use `ConcurrentDictionary.GetOrAdd`?*

**Q5. What is a source generator and what problem does it solve?**
**A:** A Roslyn component that runs during compilation, inspects the code being compiled, and emits additional C# that is compiled alongside it. It solves the problem that reflection solves — writing code that adapts to types you did not hand-write for — but at build time, so the output is ordinary code with no runtime lookup, no allocation, full debuggability and full AOT compatibility. That is why serialisation, logging, DI registration and mapping have all been moving to generators.
*Follow-up: What can a source generator not do that reflection can?*

**Q6. Why does reflection break under trimming and NativeAOT?**
**A:** Trimming removes code that is not statically referenced, and AOT compiles ahead of time everything that will run — both need to know statically what is used. Reflection that resolves a type by name from configuration, or closes a generic from a runtime value, is invisible to that analysis, so the code is trimmed away or was never generated, and the failure appears at runtime as a missing type or method. Annotations can preserve specific members, but they only work where you can enumerate what to keep, which defeats the open-ended discovery reflection is usually used for.
*Follow-up: How would you audit a codebase for reflection that would break under AOT?*

**Q7. When is `dynamic` legitimate?**
**A:** Where the shape genuinely is not known at compile time and there is no reasonable static contract — COM interop, a scripting boundary, or consuming a payload whose structure varies per caller. It has a real cost beyond performance: no compile-time checking, no refactoring support, no IntelliSense, and errors surfacing as runtime binder exceptions. So it should be confined to the boundary where the dynamism actually exists and converted into a typed model immediately. Using it to avoid defining an interface trades a design decision for a class of runtime failures.
*Follow-up: What does the DLR's call-site caching do, and does it make `dynamic` fast?*

**Q8. What is `AssemblyLoadContext` and why does collectibility matter?**
**A:** It is the isolation and lifetime boundary for loaded assemblies, and a *collectible* context can be unloaded, freeing the assemblies and their types. That matters for plugin architectures: without a collectible context, every loaded plugin assembly stays for the process lifetime, so a system that loads plugins dynamically leaks type and code-heap memory that is never reclaimed. Unloading is also conditional — any lingering reference to a type from that context prevents it, which is why plugin unload is notoriously difficult to get actually working.
*Follow-up: You unload a context and memory doesn't drop. How would you find what's holding it?*

**Q9. What is a dynamic proxy and where do you encounter one?**
**A:** A type generated at runtime that implements an interface or subclasses a type, forwarding calls to an interceptor — the mechanism behind AOP-style logging, transactions, caching and lazy loading in libraries like Castle DynamicProxy, and behind most mocking frameworks. It is powerful because it adds behaviour without touching the target, and costly because the behaviour is invisible at the call site, the generated types complicate stack traces and debugging, and the runtime code generation is incompatible with AOT. Recognising it explains a lot of "how does this framework do that" questions.
*Follow-up: Why can a dynamic proxy usually only intercept virtual or interface members?*

**Q10. Analyzers and source generators use the same platform. What's the difference in purpose?**
**A:** An analyzer inspects code and reports diagnostics — it enforces conventions, catches misuse and can offer code fixes, but it does not change what is compiled. A generator adds code to the compilation. In practice they pair well: a generator emits the plumbing, and an analyzer enforces the conventions the generator requires, such as the type being `partial` or a member having the expected shape. Together they are how a platform team can make a correct pattern automatic and an incorrect one a build error.
*Follow-up: You want to ban a specific API across an organisation. Analyzer, or something else?*

---

## 3. Intermediate (10 Q&A)

**Q1. A mapping layer shows up as the top CPU consumer. How do you approach it?**
**A:** First confirm what it is actually doing per call — the common finding is uncached reflection, resolving properties and attributes for every object rather than once per type. The fix in ascending order of effort is: cache the per-type metadata; replace `PropertyInfo.GetValue`/`SetValue` with compiled delegates built once per type; or replace the whole layer with a source-generated mapper, which removes the runtime work entirely. I would benchmark with realistic object shapes, because the win is proportional to property count and object volume, and I would check whether the mapping is needed at all before optimising it.
*Follow-up: The compiled-delegate approach adds startup cost per type. How do you manage that?*

**Q2. How do you cache reflection results correctly for concurrent use?**
**A:** A `ConcurrentDictionary` keyed by `Type` (or a composite key) is the usual structure, but `GetOrAdd`'s value factory can run on several threads simultaneously for the same key, with only one result kept — so if construction is expensive you waste work, and if it has side effects you have a bug. Storing `Lazy<T>` values fixes it: the factory creating the `Lazy` is cheap and idempotent, and the `Lazy` itself guarantees single execution of the expensive part. Also key on the runtime type rather than the declared one, or derived types silently share the base's cached metadata.
*Follow-up: The cache is keyed by `Type` and grows unbounded in a plugin host. What's the risk?*

**Q3. When would you write a source generator rather than using reflection?**
**A:** When the work is derivable from the code at build time and is executed often at runtime — serialisation, mapping, logging, DI registration, strongly-typed configuration or resource accessors. Those give the full benefit: no runtime lookup, no allocation, AOT compatibility and code you can read and step through. Reflection remains appropriate when the shape is genuinely unknown until runtime, such as loading plugins whose types are not referenced at compile time. The dividing question is simply whether the compiler could have known, and if it could, generation is strictly better.
*Follow-up: Your generator needs information from a config file. Is that still a good fit?*

**Q4. What makes a source generator good or bad to live with?**
**A:** It runs inside the IDE on every keystroke, so it must be fast and incremental — an `IIncrementalGenerator` with well-chosen predicates that avoid re-running on unrelated edits, and no I/O or network access. It must be deterministic, or builds stop being reproducible and incremental compilation breaks. And the generated code must be inspectable — emitting to disk during development, with readable names and structure — because a generator whose output nobody can see becomes an unfixable black box the first time it produces something unexpected. Those three properties determine whether a team keeps it or rips it out.
*Follow-up: How would you debug a generator that produces wrong output for one specific type?*

**Q5. How do you handle assembly scanning in a startup-sensitive service?**
**A:** Replace it with explicit registration, ideally generated. Scanning walks every type in every assembly, costs measurable startup time on each instance, is fragile when assemblies load lazily, and is the single most common blocker for trimming. A source generator can emit the same registrations at build time from the same conventions, giving identical developer ergonomics with none of the runtime cost. Where scanning must remain, narrowing it to specific assemblies and caching results helps, but it does not remove the AOT problem — only generation does.
*Follow-up: The team likes convention-based registration for the developer experience. How do you keep that?*

**Q6. How do attributes and reflection interact in a validation or serialisation framework, and where's the cost?**
**A:** The framework reflects over a type's members, reads attributes to build a plan, and then executes that plan per object. The cost is entirely in whether the plan is built once per type or rebuilt per object — `GetCustomAttributes` allocates and reflects on every call, so a framework doing it per instance is paying hundreds of times what it needs to. Every mature framework caches a compiled plan per type; every home-grown one I have reviewed did not, initially. It is worth checking, because this is the most common invisible performance tax in an application's own infrastructure code.
*Follow-up: How would you verify whether a third-party library caches its reflection?*

**Q7. How do you assess whether a codebase can move to NativeAOT?**
**A:** Inventory the runtime-metaprogramming surface: reflection over types resolved by name, `MakeGenericType`/`MakeGenericMethod`, `Activator.CreateInstance` with runtime types, `Reflection.Emit`, dynamic proxies, `dynamic`, and reflection-based serialisation. Then check the dependency graph, because the blockers are usually in libraries rather than in your code — an ORM, a mapper, a DI container's scanning, or an AOP framework. The migration is then a series of replacements, mostly to source generators. I would produce that inventory before committing to AOT publicly, since the discovery mid-migration is what makes these projects overrun.
*Follow-up: One critical library uses `Reflection.Emit` and has no AOT-compatible alternative. What are your options?*

**Q8. What are the risks of interception and AOP in an application architecture?**
**A:** Behaviour becomes invisible at the call site: a method that appears to do one thing is also opening a transaction, writing a log, checking a cache and retrying, none of which is in the code you are reading. That is powerful and genuinely hard to debug years later, particularly when the interception order matters and is defined somewhere else. It also requires runtime type generation, which forecloses AOT. My preference is explicit composition — decorators registered visibly in the composition root — which gives the same cross-cutting behaviour with the ordering and the participants visible in one readable place.
*Follow-up: You inherit a system using interception for transactions across 200 services. Do you migrate it?*

**Q9. When should you use expression trees rather than reflection or generation?**
**A:** When you need to build behaviour from runtime information but execute it many times — the compile-once, invoke-many pattern that makes a compiled delegate nearly as fast as hand-written code. That is why ORMs and mappers use them internally. The costs are that `Compile()` is expensive so the result must be cached, the compiled code is invisible to a debugger, and — decisively for some architectures — compilation is runtime code generation, so it does not work under AOT. Where the shape is known at compile time, a source generator gives the same performance without any of those limitations.
*Follow-up: How would you cache compiled expressions without the cache itself becoming a leak?*

**Q10. How do you decide between generics, reflection and generation for a "works with any type" requirement?**
**A:** In that order of preference. Generics with constraints are checked at compile time, cost nothing at runtime and work everywhere — they cover more cases than people expect, especially with static abstract interface members. Source generation covers cases generics cannot, such as per-type serialisers, still with no runtime cost. Reflection is the fallback for genuinely runtime-unknown shapes, and should be cached and confined. The mistake is starting at reflection because it is the most flexible, and thereby paying runtime cost and losing AOT for a requirement the type system could have expressed.
*Follow-up: Give me a case where generics genuinely cannot express the requirement.*

---

## 4. Expert / Architect (10 Q&A)

**Q1. How do you set a policy on runtime metaprogramming across an estate?**
**A:** Tie it to the deployment strategy, because that is what makes it a real constraint rather than a preference. If AOT or trimming is a strategic goal for any workload class, then reflection-driven type discovery and runtime generic instantiation are banned patterns in that class, with source generation as the sanctioned alternative — and that has to be decided *before* a large codebase exists. Elsewhere, the policy is narrower: reflection is acceptable at startup and in tooling, and requires caching plus justification on request paths. I would enforce with analyzers where possible and with a documented review trigger where not, since the failure mode is silent.
*Follow-up: Half the estate needs AOT and half doesn't. How do you avoid two incompatible standards?*

**Q2. How would you evaluate introducing a source generator into a shared build?**
**A:** As a build-time dependency the whole organisation will now carry, so the bar is ownership and lifecycle: who maintains it, how it is versioned, what happens when the Roslyn API changes, and how a broken generator is rolled back — because a generator failure blocks every build, not one service. Technically I would require incrementality and IDE performance evidence, determinism, emitted output for inspection, and tests over the generator itself. Given those, generators are excellent value, replacing runtime cost with build-time work. Without them, a generator becomes the thing everyone is afraid to upgrade.
*Follow-up: The generator's author leaves the company. What should already be in place?*

**Q3. What's the architectural cost of the ecosystem's reliance on runtime reflection?**
**A:** It made .NET's frameworks enormously productive — DI, ORMs, serialisers and test frameworks all work by convention with no code generation — and it deferred a cost that is now being paid. Trimming, AOT, startup-sensitive serverless and mobile targets all require static knowledge, so the ecosystem is migrating to generators, and applications built deeply on reflection-driven libraries are the ones that cannot follow. The architectural lesson is that a runtime-flexibility choice is also a deployment-options choice, and the coupling only becomes visible years later — which is a good argument for preferring the statically-known mechanism when both are available.
*Follow-up: How would you factor that into choosing a library today?*

**Q4. How do you design a plugin architecture that can actually unload plugins?**
**A:** With a collectible `AssemblyLoadContext` per plugin and extreme discipline about references escaping it: any type, delegate, or object from the plugin held by the host prevents unload, and that includes event subscriptions, cached `Type` objects, static references and running tasks. So the host must interact with plugins only through interfaces defined in a shared assembly loaded in the default context, and must have an explicit teardown that unsubscribes and drains before unloading. I would also verify unload actually happens with a test that forces collection and asserts the context is gone, because "it should unload" is almost never true first time.
*Follow-up: You need to pass a callback from the host into the plugin. How do you avoid pinning the context?*

**Q5. How would you approach migrating a large reflection-based framework to source generation?**
**A:** Incrementally and behind the same public API, so consumers are unaffected: generate for the types that opt in, fall back to reflection for the rest, and migrate consumers gradually with telemetry showing which path each type takes. That dual-path period is essential because a big-bang switch on a framework used across an estate is unreviewable. I would prioritise by benefit — the highest-volume types and the ones blocking AOT — and I would keep the reflection path until usage telemetry shows it is unused rather than until a date passes. The main risk to manage is behavioural divergence between the two paths, which needs a differential test suite.
*Follow-up: The generated and reflected paths produce subtly different output for one edge case. How do you handle that?*

**Q6. What's your position on convention-over-configuration frameworks at scale?**
**A:** Conventions are excellent while everyone knows them and terrible once they are implicit. Reflection-driven conventions have no compile-time verification, so a renamed method or a missing suffix produces a runtime failure or — worse — silent non-registration, and the failure is far from the change. At small scale that is a fine trade for the ergonomics. At large scale I prefer conventions enforced by analyzers and realised by generators, which keeps the developer experience while making violations build errors. The key point is that a convention nobody can violate accidentally is worth far more than one that is merely documented.
*Follow-up: A team's handler isn't being registered and nothing errors. How would you have prevented that class of bug?*

**Q7. How do you weigh the debuggability cost of metaprogramming?**
**A:** Heavily, because it is paid by everyone who maintains the system afterwards rather than by the author. Runtime-generated proxies produce stack traces full of synthetic types; expression-compiled delegates cannot be stepped into; interception hides behaviour from the call site; and reflection-driven wiring means "find all references" does not find the caller. Source generation is much better on this axis precisely because the output is real, readable, steppable code. So when comparing mechanisms of equal capability, I weight debuggability high — the operational cost of an undiagnosable production issue at 3 a.m. exceeds most of the performance differences being argued about.
*Follow-up: How would you make a generated-code approach genuinely debuggable in production stack traces?*

**Q8. How does metaprogramming interact with security?**
**A:** It is a real attack surface. Reflection can reach private members, so it defeats encapsulation as a boundary — anything relying on `private` for security rather than for design is not protected. Loading assemblies from paths or names influenced by input is a code-execution risk, as is deserialisation that resolves types from the payload, which is the classic remote-code-execution pattern across every platform. Runtime code generation from untrusted input is worse still. I would treat any code path where input influences type resolution, assembly loading or member invocation as requiring explicit threat modelling and a closed allow-list rather than open resolution.
*Follow-up: A feature lets users configure a "handler type name". How do you make that safe?*

**Q9. How do you decide whether an abstraction should be resolved at compile time or runtime?**
**A:** By whether the set of possibilities is closed at build time. If it is — the handlers in this assembly, the serialisable types in this contract, the endpoints in this service — resolve it at compile time, because you get checking, performance, AOT compatibility and navigable code. If it genuinely is not — plugins deployed independently, tenant-specific extensions, scripting — then runtime resolution is the right tool and its costs are the price of the capability. The failure I see most is using runtime resolution for a closed set out of habit, paying every cost for flexibility that is never exercised.
*Follow-up: The set is closed today but the roadmap says plugins next year. What do you build now?*

**Q10. What separates an excellent answer from an adequate one on metaprogramming?**
**A:** An adequate answer knows reflection is slow and should be cached. An excellent one places the mechanisms on a spectrum — direct code, generics, source generation, cached delegates, reflection, emit, `dynamic` — and picks the least powerful one that solves the problem, because power here is paid for in checking, performance, debuggability and deployment options. It knows *which* reflection operations cost what, distinguishes the startup-once case from the per-request case, treats AOT and trimming compatibility as an architectural constraint rather than a detail, and weighs the maintenance cost of invisible behaviour. The distinguishing quality is treating runtime flexibility as something to be purchased deliberately rather than assumed free.
*Follow-up: Given that spectrum, where would you place a DI container's constructor resolution, and would you change it?*
