# Module — C# Advanced: Strings, Text, Encoding & Globalization

> Domain: C# | Level: Beginner → Expert | Prerequisite: [[01-CLR-JIT-GC-Memory-Management]] (string allocation, LOH), [[03-Span-Memory-Low-Allocation]] (`ReadOnlySpan<char>`, UTF-8 formatting), [[10-Collections-BCL-Internals]] (string keys, `StringComparer`)

---

## 1. Topic Description

### Definition

A .NET `string` is an **immutable sequence of UTF-16 code units** — not characters — allocated on the heap with a length prefix. That single sentence contains most of the subject's difficulty: immutability determines the allocation profile, UTF-16 means a `char` is a code unit rather than a user-perceived character, and "sequence" hides the fact that comparison, ordering and casing are **culture-dependent operations** with different results on different machines. **Encoding** is the separate concern of converting between that in-memory representation and bytes on a wire or on disk, where getting it wrong produces corruption rather than an exception.

### Core sub-concepts

- **String representation** — immutability, UTF-16 code units, length in code units versus characters, and the memory cost of small strings.
- **Interning** — the intern pool, compile-time literal interning, `string.Intern` and why interned strings are never collected.
- **Concatenation and building** — compiler-optimised `+` on literals, `String.Concat`, `StringBuilder`, and the quadratic behaviour of concatenation in a loop.
- **Interpolation** — how interpolated strings compile, and the interpolated-string handler that avoids formatting when a log level is disabled.
- **Ordinal versus culture-sensitive comparison** — `StringComparison` options, the default behaviour of each API, and why the defaults differ between `Equals`, `Compare`, `IndexOf` and `StartsWith`.
- **Culture-dependent casing** — the Turkish dotless-`ı` problem and why `ToLower()` for normalisation is a defect.
- **`CultureInfo`** — current culture versus current UI culture, invariant culture, and thread/async flow of culture.
- **Sorting and collation** — linguistic ordering versus ordinal ordering, and the fact that sort order is not stable across cultures or ICU versions.
- **Unicode fundamentals** — code points, surrogate pairs, combining characters, grapheme clusters, and `StringInfo` for text elements.
- **Normalisation** — NFC/NFD/NFKC/NFKD, canonically equivalent strings comparing unequal, and normalisation as a security control.
- **Encoding** — UTF-8, UTF-16, UTF-32, BOMs, `Encoding.UTF8` versus `UTF8Encoding(false)`, and lossy decoding versus throwing on invalid bytes.
- **UTF-8 in modern .NET** — `u8` literals, `Utf8Formatter`/`Utf8Parser`, `Encoding.UTF8.GetBytes` into a span, and staying in UTF-8 end to end.
- **Parsing and formatting** — `IFormattable`, `ISpanFormattable`, `TryParse` with explicit culture, standard and custom format strings.
- **Globalization modes** — ICU versus NLS, `InvariantGlobalization` in containers, and the behaviour changes each implies.
- **Text security** — homoglyphs and confusables, normalisation before comparison, length limits in code points versus bytes.

### Where it fits

Text is the interface between a program's internal model and everything outside it — HTTP payloads, database columns, file formats, log lines, user input and identifiers. It sits directly on the allocation model from `01` (strings are among the most-allocated objects in a typical service), connects to `03` through `ReadOnlySpan<char>` and UTF-8 formatting as the low-allocation path, and to `10` through string keys and comparer selection in dictionaries. Upward it determines API contract correctness: whether a date parses the same way in every environment, whether two identifiers that look identical compare equal, and whether a value round-trips through storage unchanged.

### Why it matters at scale

Text defects are quiet and environment-dependent, which makes them expensive. Culture-sensitive comparison and parsing mean the same code produces different results on a developer machine, a CI runner and a production container — `03/04/2026` is March or April depending on the culture, decimal separators invert between locales, and a case-insensitive comparison behaves differently under a Turkish culture. Those are not edge cases in a financial system; they are wrong amounts and wrong dates. Encoding mistakes are worse because they are silent: decoding with the wrong encoding produces replacement characters rather than an exception, so corrupted data is written to storage and discovered much later, by which point the original bytes are gone. On the performance side, strings dominate allocation in most services, and a concatenation loop is the classic accidental quadratic that is fine at ten items and fatal at ten thousand.

### Common pitfalls / anti-patterns

- **String concatenation inside a loop** — every `+=` allocates a new string and copies everything before it, so building a large string is O(n²) in both time and allocation; `StringBuilder` makes it linear.
- **Using culture-sensitive comparison for identifiers, keys and protocol tokens** — `==` on strings is ordinal, but `Compare`, `StartsWith`, `EndsWith` and `IndexOf` default to culture-sensitive, so file paths, header names and enum-like tokens get locale-dependent behaviour; specify `StringComparison.Ordinal` explicitly.
- **`ToLower()` or `ToUpper()` for case-insensitive comparison** — allocates a new string *and* is culture-dependent; under a Turkish culture `"I".ToLower()` is not `"i"`, so a login or a lookup silently fails for some users. Use `string.Equals(a, b, StringComparison.OrdinalIgnoreCase)`.
- **Parsing or formatting numbers and dates without an explicit culture** — the ambient culture differs between machines and containers, so the same input parses to different values, or a serialised decimal uses a comma and is rejected downstream.
- **Assuming `string.Length` counts characters** — it counts UTF-16 code units, so emoji and many scripts count as two, and truncating by length can split a surrogate pair and corrupt the text.
- **Comparing unnormalised Unicode** — the same visible text can be composed or decomposed, so canonically equivalent strings compare unequal and a duplicate check silently passes.
- **Decoding bytes with the wrong or default encoding** — invalid sequences are replaced rather than throwing, so corruption is silent and permanent once the result is stored.
- **Writing UTF-8 with a BOM by default** — `Encoding.UTF8` emits a preamble, which breaks consumers expecting a bare UTF-8 stream, including many CSV and JSON parsers.
- **`string.Intern` used to save memory** — interned strings live for the process lifetime and are never collected, so interning runtime data is an unbounded leak.
- **Validating length limits in `char` count against a byte-limited store** — a column limited to 100 bytes accepts fewer than 100 characters in UTF-8, so validation passes and the insert fails.

---

## 2. Beginner (10 Q&A)

**Q1. What does string immutability actually cost, and what does it buy?**
**A:** It buys safety: strings can be shared freely across threads, used as dictionary keys with stable hashes, and passed without defensive copying, because nothing can change them. It costs an allocation for every modification — every concatenation, substring, trim, replace or case change produces a new string and copies the data. That is fine for occasional use and quadratic in a loop, which is why `StringBuilder` exists. The design consequence is that string-heavy processing is usually allocation-bound rather than CPU-bound.
*Follow-up: Given immutability, why does `string.Substring` allocate when `ReadOnlySpan<char>` slicing doesn't?*

**Q2. When is `StringBuilder` worth using?**
**A:** When the number of concatenations is not known at compile time — typically a loop. The compiler optimises adjacent literal concatenations and a fixed sequence of `+` into a single `String.Concat` call, so a handful of concatenations in one expression is already efficient and `StringBuilder` there is noise. In a loop it is different: each `+=` copies everything accumulated so far, so cost grows quadratically, and `StringBuilder` amortises it with a growable buffer. The rule is: fixed and small, use `+`; unbounded or in a loop, use `StringBuilder`.
*Follow-up: You know the final length approximately. What do you do differently?*

**Q3. What's the difference between ordinal and culture-sensitive comparison, and which is the default?**
**A:** Ordinal compares UTF-16 code units numerically — fast, deterministic, and identical everywhere. Culture-sensitive comparison applies linguistic rules that vary by culture, so ordering and equality depend on the machine's settings and even on the ICU version. The defaults are inconsistent and this is the trap: `==` and `Equals(string)` are ordinal, but `string.Compare`, `CompareTo`, `StartsWith`, `EndsWith` and `IndexOf` default to culture-sensitive. So code that looks uniform behaves differently depending on which API it happens to use.
*Follow-up: Which should you use for a file path, and which for a list of names shown to a user?*

**Q4. Why is `ToLower()` the wrong way to do case-insensitive comparison?**
**A:** Two reasons. It allocates a new string for each operand, which is pure waste when you only want a comparison. More importantly it is culture-dependent: in Turkish, uppercase `I` lowercases to a dotless `ı`, not `i`, so `"ADMIN".ToLower() == "admin"` is false on a Turkish-culture machine. That is a real, documented class of production bug affecting authentication and lookups. `string.Equals(a, b, StringComparison.OrdinalIgnoreCase)` is allocation-free and culture-independent.
*Follow-up: When would `ToLowerInvariant` be acceptable?*

**Q5. What is the difference between `CurrentCulture` and `CurrentUICulture`?**
**A:** `CurrentCulture` controls formatting and parsing of numbers, dates and currency; `CurrentUICulture` controls which resource set is loaded for localised text. They are independent, which is correct — a user may want an English interface with German number formatting. The operational point is that both are ambient state that flows with `ExecutionContext` across async boundaries, so setting culture per request works, but forgetting to set it means you inherit the host's, which differs between a developer machine and a container.
*Follow-up: How would you set culture per request in a web service, and what's the risk of getting it wrong?*

**Q6. What is a surrogate pair and why does it matter?**
**A:** UTF-16 encodes code points above U+FFFF as two 16-bit units — a surrogate pair — so a single user-visible character such as an emoji occupies two `char` values. That means `string.Length` is not a character count, indexing into a string can land in the middle of a character, and truncating by length can split a pair and produce invalid text. Combining characters compound this: an accented letter may be one code point or two, so even code-point counting does not give user-perceived characters. `StringInfo` and grapheme enumeration are what handle text elements correctly.
*Follow-up: You must truncate a display name to 20 characters. How do you do it correctly?*

**Q7. What is Unicode normalisation and when do you need it?**
**A:** The same visible text can have multiple valid encodings — an accented character as a single composed code point or as a base letter plus a combining mark — and those compare unequal byte-for-byte despite being canonically equivalent. Normalisation converts to a canonical form (NFC is the usual choice) so equivalent text compares equal. You need it wherever text is compared, deduplicated, used as a key, or checked for uniqueness, and particularly at input boundaries — otherwise two users can register what appears to be the same username.
*Follow-up: What's the difference between NFC and NFKC, and when would you use the compatibility form?*

**Q8. What does `Encoding.UTF8` do that catches people out?**
**A:** It emits a byte-order mark by default when used to write, which is a three-byte preamble many consumers do not expect — a common cause of a leading garbage character in CSV imports and JSON parsers. `new UTF8Encoding(false)` writes without one. It also, by default, replaces invalid byte sequences with U+FFFD rather than throwing, so decoding corrupt or wrongly-encoded data succeeds silently and produces mangled text. For data-integrity-critical paths, constructing an encoding with `throwOnInvalidBytes: true` converts silent corruption into an exception.
*Follow-up: You receive a file with an unknown encoding. How do you handle it responsibly?*

**Q9. What is the string intern pool, and why shouldn't you use `string.Intern` freely?**
**A:** Literal strings in your source are interned automatically so identical literals share one instance. `string.Intern` lets you add runtime strings to that pool, which deduplicates memory for repeated values — but interned strings are rooted for the process lifetime and are never collected. Interning values derived from user input or from a data feed is therefore an unbounded memory leak with no eviction. If deduplication is genuinely needed, a bounded cache you control is the correct mechanism.
*Follow-up: Why can locking on a string be dangerous, and how does interning relate?*

**Q10. What does `InvariantGlobalization` do in a container?**
**A:** It removes ICU and makes all culture-sensitive operations behave as invariant, which shrinks the image and removes a native dependency. The consequence is that culture-specific formatting, parsing, casing and collation stop working correctly — requesting a specific culture silently gives you invariant behaviour rather than failing. For a service that only handles machine-readable, culture-invariant data that is a reasonable simplification; for anything doing user-facing formatting or linguistic sorting it is a silent correctness change. It should be a deliberate decision, not an inherited base-image default.
*Follow-up: How would you detect that your service is running in invariant mode when it shouldn't be?*

---

## 3. Intermediate (10 Q&A)

**Q1. A date parses correctly in dev and incorrectly in production. Walk me through it.**
**A:** Ambient culture. `DateTime.Parse` without an explicit `IFormatProvider` uses `CurrentCulture`, which differs between a developer machine, a CI runner and a container base image — so `03/04/2026` becomes March or April depending on where it runs, with no error either way. The fix is twofold: parse and format with `CultureInfo.InvariantCulture` and an explicit format for anything machine-readable, and use ISO-8601 with an offset on the wire. I would also pin the culture explicitly at startup rather than inheriting the host's, so behaviour is identical everywhere and the environment cannot change semantics.
*Follow-up: The same class of bug for decimals — what does it look like and where does it bite hardest?*

**Q2. How do you choose a `StringComparison` for a given comparison?**
**A:** By asking whether the comparison is *linguistic* or *symbolic*. Anything machine-oriented — identifiers, keys, paths, protocol tokens, header names, enum-like values — is symbolic and must be `Ordinal` or `OrdinalIgnoreCase`, which is faster and identical everywhere. Anything presented to or entered by a user where linguistic equivalence matters — sorting a displayed list, searching names — is culture-sensitive and should use the relevant culture explicitly. The failure is leaving it implicit, because the defaults vary by API, so I would require an explicit `StringComparison` argument as a code standard.
*Follow-up: Can you enforce "always specify StringComparison" mechanically?*

**Q3. How do string keys in a dictionary affect performance and correctness?**
**A:** Both, and the comparer choice controls them. `StringComparer.Ordinal` hashes and compares bytes, which is substantially faster than a culture-aware comparer that must apply collation rules; `StringComparer.OrdinalIgnoreCase` is the right choice for case-insensitive keys and avoids allocating lowercase copies. Using a culture-sensitive comparer makes lookups both slower and machine-dependent, so a key that matches in one environment may not in another. Passing the comparer explicitly at construction is the fix, and it is a one-line change that often shows up in profiles.
*Follow-up: You need case-insensitive lookup on user-entered text that may contain accents. What do you use?*

**Q4. How do you reduce string allocation on a hot path?**
**A:** In order of leverage: avoid producing the string at all — compare with spans, or use `TryParse` on a `ReadOnlySpan<char>` rather than substringing first; use `ReadOnlySpan<char>` slicing where `Substring` was allocating; format directly into a buffer with `TryFormat`/`ISpanFormattable` or `string.Create` rather than composing intermediates; and stay in UTF-8 end to end when the sink is a socket or a file, avoiding transcoding entirely. The largest realistic win in most services is not string mechanics at all, but interpolated log messages being built for levels that are then filtered out.
*Follow-up: How do interpolated-string handlers solve that logging case?*

**Q5. Why is decoding with the wrong encoding worse than a crash?**
**A:** Because it succeeds. Default decoders replace invalid sequences with U+FFFD rather than throwing, so the operation reports success and produces plausible-looking but corrupted text, which then gets stored — and once the original bytes are gone the damage is irreversible. The mitigations are to construct encoders and decoders with `throwOnInvalidBytes: true` on data-integrity paths so corruption becomes an exception, to specify encoding explicitly at every boundary rather than relying on defaults, and to treat encoding as part of the interface contract rather than an implementation detail.
*Follow-up: You discover six months of records with replacement characters. What's your response?*

**Q6. How do you handle text length limits correctly?**
**A:** By being explicit about the unit, because three different ones are in play: UTF-16 code units (`string.Length`), Unicode code points, and bytes in a target encoding. A database column limited to 100 bytes accepts fewer than 100 characters in UTF-8 for non-ASCII text, so validating `Length <= 100` passes and the insert fails — a genuinely common bug in internationalised systems. For user-facing truncation the right unit is grapheme clusters, so you do not split a surrogate pair or separate a combining mark. I would validate in the unit the *destination* enforces and truncate in the unit the *user* perceives.
*Follow-up: A user's name is truncated mid-emoji and the API returns invalid UTF-8. How do you fix it?*

**Q7. What are the security dimensions of text handling?**
**A:** Several. Homoglyph and confusable characters let visually identical identifiers be distinct strings, which enables impersonation in usernames and domains — normalisation plus a confusables check is the defence. Unnormalised comparison lets a uniqueness check be bypassed by an equivalent encoding. Case-insensitive comparison done culture-sensitively can behave differently for some users, which has produced real authentication bypasses. And length validation in the wrong unit lets oversized input through. I would treat any text used for identity, authorisation or uniqueness as requiring explicit normalisation and ordinal comparison, decided deliberately.
*Follow-up: How would you validate a username to prevent homoglyph impersonation?*

**Q8. How does culture flow through an async request pipeline?**
**A:** `CurrentCulture` and `CurrentUICulture` are stored on the thread but flow with `ExecutionContext`, so they propagate across `await` boundaries and onto continuations — which is what makes per-request culture work in ASP.NET Core's localisation middleware. Where it breaks is anywhere `ExecutionContext` does not flow: work queued without flow, threads created manually, and long-lived background services that never had a request's culture set. Those inherit the process culture, so a background job formats differently from the request path that created its data.
*Follow-up: A background job writes dates in a different format from the API. Where would you look?*

**Q9. When should you work in UTF-8 rather than converting to `string`?**
**A:** When the data arrives as UTF-8 bytes and leaves as UTF-8 bytes and the intermediate `string` exists only because that is the habitual type — a JSON payload parsed, inspected and re-emitted, or a protocol frame with a few fields compared against known values. Transcoding to UTF-16 and back allocates and copies twice for no benefit. `u8` literals, `Utf8Parser`/`Utf8Formatter` and span-based APIs let you compare, parse and format without materialising strings. It is a hot-path technique, and on a warm path the readability of `string` is worth more than the saving.
*Follow-up: What's the catch when comparing UTF-8 bytes for equality rather than comparing strings?*

**Q10. How do you make string handling testable across cultures?**
**A:** Run the relevant tests under several explicitly-set cultures — invariant, one comma-decimal culture such as German, and Turkish for the casing case — because those three catch the majority of real defects. Assert on behaviour that should be culture-independent using ordinal comparisons, and assert on culture-specific formatting with explicit cultures rather than the ambient one. I would also run the suite in a container matching production, since globalization mode and ICU version differ from a developer machine and are exactly the variables that change behaviour.
*Follow-up: A test passes locally and fails in CI only for date assertions. What's your first hypothesis?*

---

## 4. Expert / Architect (10 Q&A)

**Q1. How do you set text-handling standards across an organisation?**
**A:** Make the safe choice the default and the unsafe one explicit: mandate an explicit `StringComparison` and `IFormatProvider` at every call that accepts one, enforced by analyzers rather than review, since these are exactly the omissions review misses. Standardise wire formats — ISO-8601 with offsets, invariant numeric formatting, UTF-8 without BOM — in a shared serialisation configuration so services do not each decide. Pin culture explicitly at startup rather than inheriting the environment's. The reason this must be mechanical is that every one of these defects is environment-dependent, so it will pass in one environment and fail in another regardless of how careful the author was.
*Follow-up: Which of these would you make a build error versus a warning, and why?*

**Q2. How do you design a system for correct internationalisation from the start?**
**A:** Separate the concerns that get conflated: the user's *language* (which resources to load), their *formatting* preferences (dates, numbers, currency), the *data's* culture (a value entered in one locale and displayed in another), and *storage*, which should be culture-neutral and unambiguous. Store instants as UTC with offsets, amounts as decimal with an explicit currency, and text normalised. Then format at the presentation boundary only. Systems that get this wrong almost always did so by formatting too early — a date formatted to a string in a service layer has lost the information needed to display it correctly elsewhere.
*Follow-up: A stakeholder wants a "local time" column in a report. What questions do you ask?*

**Q3. What's the architectural risk of implicit culture dependence?**
**A:** That behaviour depends on the environment rather than on the code, so the same build produces different results in different places and the difference is invisible in a diff. That defeats the central promise of promoting one artefact through environments, and it means a base-image change or a host-configuration change can silently alter business results — a container switching to invariant globalization, or an ICU version bump changing collation order. In a regulated context that is also an auditability problem, because you cannot demonstrate the system behaved identically. The mitigation is to eliminate ambient dependence: explicit culture at every boundary, pinned at startup.
*Follow-up: How would you prove to an auditor that a calculation is culture-independent?*

**Q4. How do you handle a migration to `InvariantGlobalization` or a different ICU version?**
**A:** Treat it as a behavioural change, not a configuration one. Collation order, casing and formatting can all change, so anything that sorts, compares case-insensitively, or formats for users is affected — and stored data derived from those operations may now be inconsistent with newly-computed values, which is the subtle and expensive part. I would inventory culture-sensitive operations, convert everything that should be ordinal to ordinal (which removes the exposure entirely), test the remainder under both configurations, and roll out behind a canary with comparison. Sorted indexes and persisted ordering deserve specific attention.
*Follow-up: A database collation and your application's comparison now disagree. What breaks?*

**Q5. How do you approach text as an attack surface in a public-facing system?**
**A:** Normalise at the boundary and compare ordinally afterwards, so equivalence is decided once by a rule you chose rather than incidentally by whatever the comparison API defaults to. Restrict character sets for identity-bearing fields, apply confusables detection where impersonation matters, validate length in the unit that the storage and downstream systems enforce, and reject rather than silently replace invalid encodings. I would also treat text length and content limits as denial-of-service controls, since unbounded text drives allocation. The general principle is that any text used for identity, authorisation or uniqueness needs an explicit canonical form.
*Follow-up: Normalisation itself can change length and content. How does that interact with your length validation?*

**Q6. How do you decide when low-allocation text handling is worth the complexity?**
**A:** From evidence that text allocation is a leading cost — high gen0 rates traceable to string operations, or a hot path whose profile is dominated by parsing and formatting. In a service dominated by I/O, converting readable string code to spans buys nothing measurable and costs permanent readability. Where it is justified, I would contain it: span-based parsing behind an ordinary API, benchmarked, with tests covering the edge cases the readable version got for free — surrogate pairs, empty inputs, boundary slices. The most common misallocation of effort here is optimising string handling in a service whose real cost is a database round trip.
*Follow-up: What single text-related change gives the biggest realistic win in a typical service?*

**Q7. How do encoding decisions propagate through a system's contracts?**
**A:** They become part of every interface: the API's charset, the database column type and collation, the file format, the message payload encoding, and the log pipeline's expectations. A mismatch anywhere corrupts data silently, and because each hop can succeed with replacement characters, the corruption is discovered far downstream. So encoding belongs in the contract explicitly — UTF-8 without BOM as an organisational default, declared in API content types and in file format specifications, with strict decoding on integrity-critical paths. I would also test round-trips with genuinely non-ASCII data, since ASCII-only test data hides every one of these defects.
*Follow-up: A partner sends files in a legacy encoding. How do you integrate that safely?*

**Q8. How do you handle text in a system that must support many languages and scripts?**
**A:** Assume from the start that text is not ASCII, not left-to-right, not one code unit per character, and not case-convertible in a single way. Practically: store and transmit UTF-8, normalise on input, never assume length equals character count, never build UI logic on character indices, and keep translatable text out of code entirely. Sorting must use a specified culture and be understood as unstable across ICU versions, so persisted sort order is a hazard. I would also ensure test data includes CJK, RTL and emoji from the beginning, because retrofitting internationalisation after ASCII assumptions have spread is far more expensive than designing for it.
*Follow-up: A search feature must work across scripts. What are the specific problems?*

**Q9. How would you diagnose intermittent, environment-specific text bugs?**
**A:** Establish what actually differs between environments first — culture settings, globalization mode, ICU version, container base image, database collation — because these bugs are almost always caused by an environmental difference rather than by data. Then find the culture-sensitive operations in the affected path, since a bug that behaves differently by environment almost certainly passes through one. Logging the effective culture and globalization mode at startup makes this a one-minute check rather than a day's investigation, and I would treat that as standard startup telemetry for any service handling user-facing text or parsing external data.
*Follow-up: The environments are identical and the bug still varies. What else could produce that?*

**Q10. What separates an excellent answer from an adequate one on text handling?**
**A:** An adequate answer knows strings are immutable and `StringBuilder` exists. An excellent one treats comparison, casing, parsing and formatting as **culture-dependent operations requiring an explicit decision each time**, and can name the concrete failures — Turkish casing, decimal separators, collation instability, silent replacement on decode. It distinguishes code units from code points from graphemes and knows which one each validation should use; treats normalisation as a correctness and security control rather than a nicety; makes encoding part of the contract; and recognises that these defects are environment-dependent and therefore invisible to ordinary testing. The distinguishing quality is treating text as a domain with real rules rather than as a primitive type.
*Follow-up: Given that, what would you add to a code review checklist for any method taking user-supplied text?*
