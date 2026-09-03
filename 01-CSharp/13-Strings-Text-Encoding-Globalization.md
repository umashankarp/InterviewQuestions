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

**Q1. What's the complexity of this, and how do you fix it?**
```csharp
var sb = "";
foreach (var line in lines)   // 50,000 lines
    sb += line + "\n";
```
**A:** O(n²). Strings are immutable, so every `+=` allocates a new string and copies everything accumulated so far — 50,000 iterations means copying gigabytes in total. `StringBuilder` amortises it with a growable buffer and makes it linear. Worth knowing the compiler *does* optimise a fixed sequence of `+` in one expression into a single `String.Concat`, so the problem is specifically concatenation in a loop.
*Follow-up: You know the approximate final length. What do you do differently?*

**Q2. Why can this fail on a Turkish-locale server?**
```csharp
if (role.ToLower() == "admin") GrantAccess();
```
**A:** In Turkish, uppercase `I` lowercases to a dotless `ı`, not `i` — so `"ADMIN".ToLower()` isn't `"admin"` and the check fails. It also allocates a string just to do a comparison. Use `string.Equals(role, "admin", StringComparison.OrdinalIgnoreCase)`, which is allocation-free and culture-independent. This is a real documented class of bug that has affected authentication in shipped systems.
*Follow-up: When would `ToLowerInvariant` be acceptable?*

**Q3. Which of these are ordinal and which are culture-sensitive by default?**
```csharp
a == b;  a.Equals(b);  string.Compare(a, b);  a.StartsWith(b);  a.IndexOf(b);
```
**A:** The first two are ordinal. `Compare`, `StartsWith` and `IndexOf` default to culture-sensitive. That inconsistency is the trap — code that looks uniform behaves differently depending on which API it happens to use, and the culture-sensitive ones vary by machine and even by ICU version. For identifiers, paths, protocol tokens and anything machine-oriented, pass `StringComparison.Ordinal` explicitly every time.
*Follow-up: Can you enforce "always specify StringComparison" mechanically?*

**Q4. What does `"👋".Length` return, and why does that matter?**
**A:** 2. `Length` counts UTF-16 code units, and characters above U+FFFF are encoded as a surrogate pair. So it isn't a character count — which means truncating by length can split a pair and produce invalid text, and index arithmetic can land mid-character. Combining marks make it worse: an accented letter may be one code point or two, so even code-point counting doesn't give user-perceived characters. `StringInfo` and grapheme enumeration handle text elements correctly.
*Follow-up: You must truncate a display name to 20 characters. How do you do it correctly?*

**Q5. Why does this parse differently in production than on your machine?**
```csharp
var d = DateTime.Parse(input);
var amount = decimal.Parse(row[3]);
```
**A:** Both use `CurrentCulture` when no `IFormatProvider` is given, and the ambient culture differs between a dev machine, a CI runner and a container base image. So `03/04/2026` is March or April depending on where it runs, and a comma is a decimal separator in some locales and a thousands separator in others — with no error either way. Parse and format with `CultureInfo.InvariantCulture` and an explicit format for anything machine-readable, and use ISO-8601 on the wire.
*Follow-up: What's the equivalent bug for *formatting*, and where does it bite hardest?*

**Q6. Two strings look identical on screen but compare unequal. What's going on?**
**A:** Unicode normalisation. The same visible text can be composed as a single code point or decomposed as a base letter plus a combining mark, and those are different byte sequences despite being canonically equivalent. So a duplicate check passes, a dictionary lookup misses, and a uniqueness constraint doesn't catch it. Normalise to a canonical form — NFC is the usual choice — wherever text is compared, deduplicated or used as a key, and particularly at input boundaries.
*Follow-up: What's the difference between NFC and NFKC, and when would you use the compatibility form?*

**Q7. What catches people out about `Encoding.UTF8`?**
**A:** Two things. It emits a byte-order mark when writing — a three-byte preamble many consumers don't expect, and a common cause of a leading garbage character in CSV and JSON parsers; `new UTF8Encoding(false)` writes without one. And by default it *replaces* invalid byte sequences with U+FFFD rather than throwing, so decoding corrupt or wrongly-encoded data succeeds silently and produces mangled text. For integrity-critical paths, construct the encoding with `throwOnInvalidBytes: true`.
*Follow-up: You receive a file with an unknown encoding. How do you handle it responsibly?*

**Q8. Why shouldn't you call `string.Intern` on runtime data?**
**A:** Interned strings are rooted for the process lifetime and are never collected. Literals in your source are interned automatically, which is fine because the set is fixed. Interning values derived from user input or a data feed is an unbounded memory leak with no eviction — memory grows with the number of distinct values, forever. If you genuinely need deduplication, use a bounded cache you control.
*Follow-up: Why can locking on a string be dangerous, and how does interning relate?*

**Q9. Why does this validation pass and the insert still fail?**
```csharp
if (name.Length <= 100) Save(name);   // column is VARCHAR(100) bytes
```
**A:** `Length` is UTF-16 code units and the column limit is bytes. In UTF-8, non-ASCII characters take two, three or four bytes each, so a 100-character name can easily be 200+ bytes. Validate in the unit the *destination* enforces, and truncate in the unit the *user* perceives — which are usually different units, and getting that wrong is a common internationalisation bug.
*Follow-up: The truncation splits an emoji and the API returns invalid UTF-8. How do you fix it?*

**Q10. What does `InvariantGlobalization` do in a container?**
**A:** Removes ICU and makes all culture-sensitive operations behave as invariant — smaller image, no native dependency. The consequence is that culture-specific formatting, parsing, casing and collation stop working correctly, and requesting a specific culture *silently* gives you invariant behaviour rather than failing. Reasonable for a service handling only machine-readable, culture-invariant data; a silent correctness change for anything doing user-facing formatting or linguistic sorting. It should be a deliberate decision, not an inherited base-image default.
*Follow-up: How would you detect that your service is running in invariant mode when it shouldn't be?*

---

## 3. Intermediate (10 Q&A)

**Q1. How do you choose a `StringComparison` for a given comparison?**
**A:** Ask whether it's *linguistic* or *symbolic*. Machine-oriented things — identifiers, keys, paths, protocol tokens, header names, enum-like values — are symbolic and must be `Ordinal` or `OrdinalIgnoreCase`: faster and identical everywhere. Things presented to or entered by a user where linguistic equivalence matters — sorting a displayed list, searching names — are culture-sensitive and should name the culture explicitly. The failure is leaving it implicit, because the defaults vary by API, which is why I'd make an explicit `StringComparison` argument a code standard.
*Follow-up: You need case-insensitive lookup on user text that may contain accents. What do you use?*

**Q2. How do string keys in a dictionary affect performance and correctness?**
**A:** Both, and the comparer controls them. `StringComparer.Ordinal` hashes and compares bytes, substantially faster than a culture-aware comparer applying collation rules; `OrdinalIgnoreCase` is the right choice for case-insensitive keys and avoids allocating lowercase copies. A culture-sensitive comparer makes lookups slower *and* machine-dependent, so a key matching in one environment may not in another. Passing the comparer explicitly at construction is a one-line change that often shows up in profiles.
*Follow-up: What's wrong with `dict[key.ToLower()]` as a case-insensitive scheme?*

**Q3. How do you reduce string allocation on a hot path?**
**A:** In order of leverage: avoid producing the string at all — compare with spans, `TryParse` on a `ReadOnlySpan<char>` rather than substringing first. Use span slicing where `Substring` was allocating. Format directly into a buffer with `TryFormat`/`ISpanFormattable` or `string.Create` rather than composing intermediates. Stay in UTF-8 end to end when the sink is a socket or file, avoiding transcoding. Honestly though, the biggest realistic win in most services isn't string mechanics — it's interpolated log messages being built for levels that get filtered out.
*Follow-up: How do interpolated-string handlers solve that logging case?*

**Q4. Why is decoding with the wrong encoding worse than a crash?**
**A:** Because it succeeds. Default decoders replace invalid sequences with U+FFFD rather than throwing, so the operation reports success and produces plausible-looking corrupted text, which then gets stored — and once the original bytes are gone the damage is irreversible. Mitigations: construct encoders and decoders with `throwOnInvalidBytes: true` on integrity paths so corruption becomes an exception, specify encoding explicitly at every boundary, and treat encoding as part of the interface contract rather than an implementation detail.
*Follow-up: You discover six months of records with replacement characters. What's your response?*

**Q5. What are the security dimensions of text handling?**
**A:** Homoglyphs and confusables let visually identical identifiers be distinct strings, enabling impersonation in usernames and domains — normalisation plus a confusables check is the defence. Unnormalised comparison lets a uniqueness check be bypassed by an equivalent encoding. Culture-sensitive case-insensitive comparison behaves differently for some users, which has produced real authentication bypasses. And length validation in the wrong unit lets oversized input through. Anything used for identity, authorisation or uniqueness needs explicit normalisation and ordinal comparison, decided deliberately.
*Follow-up: How would you validate a username to prevent homoglyph impersonation?*

**Q6. How does culture flow through an async request pipeline?**
**A:** `CurrentCulture` and `CurrentUICulture` are stored per thread but flow with `ExecutionContext`, so they propagate across `await` boundaries and onto continuations — which is what makes per-request localisation work. Where it breaks is anywhere `ExecutionContext` doesn't flow: work queued without flow, manually-created threads, and long-lived background services that never had a request's culture set. Those inherit the process culture, so a background job formats differently from the request path that created its data.
*Follow-up: A background job writes dates in a different format from the API. Where do you look?*

**Q7. When should you work in UTF-8 rather than converting to `string`?**
**A:** When the data arrives as UTF-8 bytes and leaves as UTF-8 bytes and the intermediate `string` exists only out of habit — a JSON payload parsed, inspected and re-emitted, or a protocol frame with a few fields compared against known values. Transcoding to UTF-16 and back allocates and copies twice for nothing. `u8` literals, `Utf8Parser`/`Utf8Formatter` and span APIs let you compare, parse and format without materialising strings. It's a hot-path technique; on a warm path the readability of `string` is worth more.
*Follow-up: What's the catch when comparing UTF-8 bytes for equality rather than strings?*

**Q8. How do you make string handling testable across cultures?**
**A:** Run the relevant tests under several explicitly-set cultures — invariant, a comma-decimal culture like German, and Turkish for the casing case — because those three catch most real defects. Assert on behaviour that should be culture-independent using ordinal comparisons, and assert culture-specific formatting with explicit cultures rather than the ambient one. Run the suite in a container matching production too, since globalization mode and ICU version differ from a dev machine and are exactly the variables that change behaviour.
*Follow-up: A test passes locally and fails in CI only for date assertions. First hypothesis?*

**Q9. How do you handle text length limits correctly across a system?**
**A:** Be explicit about the unit, because three are in play: UTF-16 code units (`string.Length`), Unicode code points, and bytes in the target encoding. Validate in the unit the destination enforces — a byte-limited column, a byte-limited message field — and truncate in the unit the user perceives, which is grapheme clusters, so you don't split a surrogate pair or separate a combining mark. Mixing them gives you validation that passes and inserts that fail, which is a common internationalisation defect.
*Follow-up: Normalisation itself can change length. How does that interact with your validation?*

**Q10. What would you change about a codebase that formats dates to strings in the service layer?**
**A:** Move the formatting to the presentation boundary. A date formatted to a string in a service has lost the information needed to display it correctly elsewhere — you can't reformat for a different user's locale, you can't compare or sort it correctly, and you've baked in a culture decision at the wrong layer. Carry `DateTimeOffset` through the system, store UTC with offsets, and format once, at the edge, with an explicit culture. Same argument for money: carry a decimal plus a currency, format at the edge.
*Follow-up: A stakeholder wants a "local time" column in a report. What questions do you ask?*

---

## 4. Expert / Architect (10 Q&A)

**Q1. How do you set text-handling standards across an organisation?**
**A:** Make the safe choice the default and the unsafe one explicit: mandate an explicit `StringComparison` and `IFormatProvider` at every call that accepts one, enforced by analyzers rather than review — these are exactly the omissions review misses. Standardise wire formats (ISO-8601 with offsets, invariant numerics, UTF-8 without BOM) in shared serialisation configuration so services don't each decide. Pin culture explicitly at startup rather than inheriting the environment's. It has to be mechanical because every one of these defects is environment-dependent, so it passes in one place and fails in another regardless of how careful the author was.
*Follow-up: Which would you make a build error versus a warning?*

**Q2. How do you design a system for correct internationalisation from the start?**
**A:** Separate the concerns that get conflated: the user's *language* (which resources load), their *formatting* preferences, the *data's* culture (a value entered in one locale and displayed in another), and *storage*, which should be culture-neutral and unambiguous. Store instants as UTC with offsets, amounts as decimal with an explicit currency, text normalised. Format only at the presentation boundary. Systems that get this wrong almost always did so by formatting too early — a date turned into a string in a service layer has lost what it needs to be displayed correctly anywhere else.
*Follow-up: How do you handle a report that must show times in each recipient's local zone?*

**Q3. What's the architectural risk of implicit culture dependence?**
**A:** Behaviour depends on the environment rather than the code, so the same build produces different results in different places and the difference is invisible in a diff. That defeats the central promise of promoting one artefact through environments, and it means a base-image change or a host-configuration change can silently alter business results — a container switching to invariant globalization, an ICU version bump changing collation. In a regulated context it's also an auditability problem, because you can't demonstrate the system behaved identically. The mitigation is eliminating ambient dependence: explicit culture at every boundary, pinned at startup.
*Follow-up: How would you prove to an auditor that a calculation is culture-independent?*

**Q4. How do you handle a migration to `InvariantGlobalization` or a new ICU version?**
**A:** As a behavioural change, not a configuration one. Collation order, casing and formatting can all change, so anything sorting, comparing case-insensitively, or formatting for users is affected — and stored data derived from those operations may now be inconsistent with newly-computed values, which is the subtle and expensive part. I'd inventory culture-sensitive operations, convert everything that should be ordinal to ordinal (which removes the exposure entirely), test the remainder under both configurations, and roll out behind a canary with comparison. Sorted indexes and persisted ordering deserve specific attention.
*Follow-up: A database collation and your application's comparison now disagree. What breaks?*

**Q5. How do you treat text as an attack surface in a public-facing system?**
**A:** Normalise at the boundary and compare ordinally afterwards, so equivalence is decided once by a rule you chose rather than incidentally by whatever the comparison API defaults to. Restrict character sets for identity-bearing fields, apply confusables detection where impersonation matters, validate length in the unit that storage and downstream systems enforce, and reject rather than silently replace invalid encodings. Treat text length and content limits as denial-of-service controls too, since unbounded text drives allocation. Anything used for identity, authorisation or uniqueness needs an explicit canonical form.
*Follow-up: Normalisation changes length and content. How does that interact with length validation?*

**Q6. When is low-allocation text handling worth the complexity?**
**A:** When there's evidence text allocation is a leading cost — high gen0 rates traceable to string operations, or a hot path whose profile is dominated by parsing and formatting. In a service dominated by I/O, converting readable string code to spans buys nothing measurable and costs permanent readability. Where justified, contain it: span-based parsing behind an ordinary API, benchmarked, with tests covering the edge cases the readable version got for free — surrogate pairs, empty inputs, boundary slices. The commonest misallocation here is optimising string handling in a service whose real cost is a database round trip.
*Follow-up: What single text-related change gives the biggest realistic win in a typical service?*

**Q7. How do encoding decisions propagate through a system's contracts?**
**A:** They become part of every interface: the API's charset, the database column type and collation, the file format, the message payload encoding, the log pipeline's expectations. A mismatch anywhere corrupts data silently, and because each hop can succeed with replacement characters, the corruption is discovered far downstream. So encoding belongs in the contract explicitly — UTF-8 without BOM as an organisational default, declared in content types and format specifications, with strict decoding on integrity-critical paths. And test round-trips with genuinely non-ASCII data, since ASCII-only test data hides every one of these defects.
*Follow-up: A partner sends files in a legacy encoding. How do you integrate that safely?*

**Q8. How do you handle text in a system supporting many languages and scripts?**
**A:** Assume from the start that text isn't ASCII, isn't left-to-right, isn't one code unit per character, and isn't case-convertible in a single way. Store and transmit UTF-8, normalise on input, never assume length equals character count, never build UI logic on character indices, keep translatable text out of code. Sorting must name a culture and be understood as unstable across ICU versions, so persisted sort order is a hazard. And include CJK, RTL and emoji in test data from the beginning, because retrofitting internationalisation after ASCII assumptions have spread is far more expensive than designing for it.
*Follow-up: A search feature must work across scripts. What are the specific problems?*

**Q9. How would you diagnose intermittent, environment-specific text bugs?**
**A:** Establish what actually differs between environments first — culture settings, globalization mode, ICU version, container base image, database collation — because these are almost always caused by an environmental difference rather than by data. Then find the culture-sensitive operations in the affected path, since a bug varying by environment almost certainly passes through one. Logging the effective culture and globalization mode at startup makes this a one-minute check rather than a day's investigation, and I'd treat that as standard startup telemetry for any service handling user-facing text or parsing external data.
*Follow-up: The environments are identical and it still varies. What else could produce that?*

**Q10. What separates an excellent answer from an adequate one on text handling?**
**A:** An adequate answer knows strings are immutable and `StringBuilder` exists. An excellent one treats comparison, casing, parsing and formatting as **culture-dependent operations requiring an explicit decision each time**, and can name the concrete failures — Turkish casing, decimal separators, collation instability, silent replacement on decode. It distinguishes code units from code points from graphemes and knows which unit each validation should use. It treats normalisation as a correctness and security control, makes encoding part of the contract, and recognises these defects are environment-dependent and therefore invisible to ordinary testing. The distinguishing quality is treating text as a domain with real rules rather than as a primitive type.
*Follow-up: Given that, what would you add to a review checklist for any method taking user-supplied text?*

---
