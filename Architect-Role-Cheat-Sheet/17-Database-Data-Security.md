# 17. Database / Data Security — 20 Questions (Answered)

> **Method:** cryptographic definitions and key-management guidance from **NIST** (SP 800-57 key management, SP 800-63B digital identity, SP 800-88 media sanitization, FIPS 197/186); password and storage guidance from the **OWASP Cheat Sheet Series**; database features from **Microsoft Learn** (SQL Server / Azure SQL — TDE, Always Encrypted, Dynamic Data Masking, Row-Level Security, auditing, Ledger) and the **PostgreSQL** documentation; cloud key, secret, backup and detection controls from **AWS** (KMS, Secrets Manager, RDS, Backup, Macie, S3); .NET implementation from **Microsoft Learn** (ASP.NET Core Data Protection, Identity, EF Core, logging); regulatory framing from **PCI DSS v4.0** and **GDPR**. SQL-injection *code-level* prevention in .NET is covered in **Module 16 Q10–Q12** — here the emphasis is the **database-side and data-lifecycle** angle. Links in **References**.

---

## Q1. Encryption vs hashing?

They are frequently conflated and they solve **opposite problems**.

| | **Encryption** | **Hashing** |
|---|---|---|
| **Reversible?** | **Yes** — by design, with the key | **No** — one-way, infeasible to invert |
| **Purpose** | **Confidentiality** — you need the data back | **Integrity / verification** — you only need to compare |
| **Key?** | Requires a key, which must be managed, rotated, protected | Keyless (a *keyed* hash — HMAC — is a separate primitive) |
| **Output size** | Roughly proportional to input | **Fixed** (SHA-256 → 32 bytes regardless of input) |
| **Typical use** | Card PAN, account numbers, PII at rest and in transit | Passwords, file/message integrity, dedup keys, hash-chained audit logs |
| **Algorithms** | AES-256-GCM, RSA-OAEP, ChaCha20-Poly1305 | SHA-256/SHA-3 (integrity); Argon2id, scrypt, bcrypt, PBKDF2 (passwords) |

**The decision rule, which is the whole answer in one line:** *do you ever need to read the original value back?* If yes → encrypt. If you only ever need to answer "does the value I was just given match what I stored?" → hash.

**Applied:**

- **A password** — you never need it back, only to verify a submitted one. **Hash.** Storing passwords encrypted is an audit finding, because whoever holds the key holds every password in plaintext.
- **A card PAN** — you must send it to the acquirer to authorise. **Encrypt**, or better, replace it with a token (Q12).
- **A customer's date of birth** — you must display it. **Encrypt.**
- **A downloaded file** — you only need to know it was not altered. **Hash.**

**The subtlety that separates a good answer:** hashing is not *automatically* safe for low-entropy data. Hash a UK sort code, a national insurance number, or a card PAN and the input space is small enough to enumerate exhaustively and build a lookup table — the hash becomes effectively reversible. **Hashing only protects values with genuine entropy, or values combined with a secret (HMAC) or a per-record salt.** This is precisely why PCI DSS does not accept a bare hash of a PAN as sufficient protection on its own.

**A third primitive people mistake for the other two: encoding.** Base64 and hex are **not security controls** — no key, no secret. If a system claims to "encrypt" a value and the output round-trips through `Convert.FromBase64String`, it has protected nothing.

---

## Q2. What is salting?

A **salt** is a **unique, random, non-secret value generated per password**, stored alongside the resulting hash, so identical inputs produce different hashes.

**The attack it defeats.** Without salt:

```text
hash("Summer2024!") -> 3f8a...c2   <- user A
hash("Summer2024!") -> 3f8a...c2   <- user B   identical
```

An attacker who steals the database sees immediately that A and B share a password and — far worse — can **precompute** the hashes of the top ten million passwords **once** and match them against **every user in every breached database simultaneously** (a rainbow table). One computation, unlimited reuse.

With a per-user salt:

```text
hash("Summer2024!" + "a17f2e9b...") -> 91cd...44   <- user A
hash("Summer2024!" + "6b03d1c7...") -> e07a...19   <- user B
```

The precomputation is now worthless: the attacker must re-run the full cracking effort **separately for every single user**. That is the entire point — **salting does not make one password harder to crack; it removes the attacker's economy of scale.**

**Properties a salt must have, per OWASP and NIST SP 800-63B:**

| Property | Why |
|---|---|
| **Unique per password** | A shared ("global") salt restores the ability to attack all users at once |
| **Cryptographically random** | `RandomNumberGenerator`, never `Random`, never a counter, never the username |
| **At least 16 bytes** (NIST floor is 32 bits; OWASP recommends far more) | Large enough that collisions across the user base are implausible |
| **Not secret** | It is stored in cleartext next to the hash — expected and fine |
| **Regenerated on every password change** | Otherwise a re-used password produces the same hash again |

**Salt vs pepper.** A **pepper** is a *secret* value applied to every hash and stored **outside the database** — in KMS, an HSM, or via `IDataProtector` — so that a database-only breach (SQL-injection dump, stolen backup) leaves the attacker unable to crack anything without also compromising the key store. It is defence in depth layered *on top of* per-user salts, never instead of them. The clean .NET implementation is to hash normally, then encrypt the resulting hash with a KMS-held key.

**In practice you rarely write this yourself.** ASP.NET Core Identity's `PasswordHasher<TUser>` generates a 128-bit salt per password and packs it into the encoded hash string. Hand-rolling salting logic is something to explain when asked *how* it works; the correct production answer is "I use the framework's hasher."

---

## Q3. How should passwords be stored?

**Hashed with a memory-hard, deliberately slow, salted password-hashing function — never encrypted, never with a fast general-purpose hash.**

**Algorithm choice, in OWASP's order of preference:**

| Algorithm | Status | Notes |
|---|---|---|
| **Argon2id** | **First choice** | Password Hashing Competition winner; memory-hard, so GPU/ASIC attacks lose their advantage. OWASP baseline: 19 MiB memory, 2 iterations, parallelism 1 |
| **scrypt** | Good alternative | Also memory-hard; use where Argon2 is unavailable |
| **bcrypt** | Acceptable, still widespread | Work factor ≥ 10. **Silently truncates input at 72 bytes** — pre-hash long passwords or reject them |
| **PBKDF2** | Acceptable, and the **FIPS-140-compliant** option | What ASP.NET Core Identity uses. Not memory-hard, so it needs a high iteration count — OWASP recommends **600,000 iterations with HMAC-SHA-256** |
| **SHA-256 / SHA-512 / MD5 / SHA-1** | **Wrong** | Designed to be *fast* — a modern GPU computes billions of SHA-256 hashes per second. Fast is exactly the property you do not want |
| **Encryption (AES)** | **Wrong** | Reversible; whoever holds the key holds every password |

**The counter-intuitive principle:** for password storage, **slow is the feature**. A user authenticating once tolerates 100 ms. An attacker cracking ten million stolen hashes cannot.

**What ASP.NET Core Identity actually does.** The default `PasswordHasher<TUser>` uses **PBKDF2 with HMAC-SHA-512, a 128-bit random salt, a 256-bit subkey, and 100,000 iterations** — the `HashPasswordV3` path, confirmed by the framework's own source comment: *"PBKDF2 with HMAC-SHA512, 128-bit salt, 256-bit subkey, 100000 iterations."* Older V2-format hashes (PBKDF2-HMAC-SHA1, 1,000 iterations) are still verifiable so existing accounts are not broken, and are transparently upgraded on next login. The stored string packs `{version}{salt}{subkey}` into one Base64 field, so you never manage the salt yourself:

**Worth flagging in an interview:** OWASP's current PBKDF2 guidance is **600,000 iterations for HMAC-SHA-256** or **210,000 for HMAC-SHA-512** — so the framework default of 100,000 sits *below* current OWASP guidance. `PasswordHasherOptions.IterationCount` is configurable in `Program.cs` (`services.Configure<PasswordHasherOptions>(o => o.IterationCount = 210_000)`), and raising it is a legitimate, low-risk hardening step: existing hashes still verify against the old count stored implicitly in their format, and `SuccessRehashNeeded` upgrades them to the new count on next login exactly as described above.

```csharp
// Registration
user.PasswordHash = _passwordHasher.HashPassword(user, plaintextPassword);

// Login
var result = _passwordHasher.VerifyHashedPassword(user, user.PasswordHash, submitted);
if (result == PasswordVerificationResult.SuccessRehashNeeded)
{
    // Stored with older/weaker parameters — upgrade now, while we still hold the plaintext
    user.PasswordHash = _passwordHasher.HashPassword(user, submitted);
    await _users.UpdateAsync(user);
}
```

That `SuccessRehashNeeded` branch answers the follow-up "how do you migrate to a stronger algorithm?" — **you cannot re-hash offline, because you do not have the plaintext.** You upgrade opportunistically at the only moment the plaintext exists: a successful login. For accounts that never return, force a reset after a cut-off date.

**The surrounding controls, per NIST SP 800-63B:**

- **Compare in constant time** — `CryptographicOperations.FixedTimeEquals`, never `==` on byte arrays, or the comparison leaks the hash byte-by-byte through timing.
- **Check candidates against a breach corpus** (Have I Been Pwned's k-anonymity API sends only the first five hex characters of the SHA-1 hash). NIST explicitly requires this check.
- **Do not impose composition rules** (one upper, one symbol…) or **periodic forced rotation** — 800-63B removed both; they push users toward predictable patterns. Enforce **minimum length 8, allow at least 64**, allow all Unicode and spaces.
- **Never log it, never put it in a URL, never return it in an API response, never let it reach an exception message** (Q15).
- **Rate-limit and lock out** after failed attempts, and **do not reveal whether the username exists** — identical response, identical timing for both cases.
- **Prefer not storing passwords at all**: federate to an IdP (Entra ID, Okta, Cognito) or adopt passkeys/WebAuthn. The most secure password database is the one you do not operate.

---

## Q4. AES vs RSA?

Two different tools, not competitors. **AES is symmetric, RSA is asymmetric**, and essentially every real system uses **both together**.

| | **AES** (FIPS 197) | **RSA** (PKCS#1 / FIPS 186) |
|---|---|---|
| **Type** | Symmetric block cipher | Asymmetric (public-key) |
| **Keys** | **One** shared secret key | **Key pair**: public encrypts / verifies, private decrypts / signs |
| **Key sizes** | 128, 192, **256** bits | **2048 minimum**, 3072/4096 preferred |
| **Speed** | **Very fast** — hardware-accelerated (AES-NI), GB/s | **~1000× slower**; cost grows sharply with key size |
| **Data size limit** | Unlimited | **Bounded by the key** — RSA-2048 with OAEP-SHA-256 encrypts at most **190 bytes** |
| **Key distribution** | **The hard part** — both parties need the same secret | **Solved** — publish the public key freely |
| **Used for** | Bulk data: columns, files, disks, TLS payloads | Key exchange, digital signatures, certificates, JWT signing (`RS256`) |

**Why RSA cannot replace AES.** Encrypting a 10 MB file with RSA is not merely slow, it is **structurally impossible**: RSA encrypts a single block bounded by the modulus. RSA-2048 with OAEP padding leaves 190 usable bytes and there is no streaming mode.

**Why AES alone is insufficient across a trust boundary.** AES needs both sides to already share a secret. Delivering that secret over an untrusted network without a pre-existing secure channel is exactly the bootstrapping problem asymmetric crypto exists to solve.

**So the real answer is the hybrid construction — the one worth drawing on the whiteboard:**

```text
1. Generate a fresh random AES-256 key  (the "data key" / "session key")
2. Encrypt the payload with AES-256-GCM             <- fast, unlimited size
3. Encrypt only the 32-byte data key with the recipient's RSA public key
4. Store/transmit: [wrapped data key] + [ciphertext] + [nonce] + [auth tag]
```

**This is exactly how TLS works** (asymmetric handshake to agree a symmetric key, then AES for the session), how S/MIME and PGP work, and how **AWS KMS envelope encryption** works: `GenerateDataKey` returns a plaintext data key plus the same key encrypted under a KMS key; you encrypt with the plaintext copy, wipe it from memory, and store the encrypted copy beside the ciphertext.

**Two modern notes an interviewer at this level expects:**

- **Use an AEAD mode.** AES-**GCM** (or AES-CCM, ChaCha20-Poly1305) provides **authenticated** encryption — it detects tampering. AES-**CBC** without a separate MAC does not, and is the source of padding-oracle attacks. In .NET use `AesGcm`; never hand-roll CBC with no MAC. **Never reuse a nonce with the same GCM key** — nonce reuse is catastrophic and leaks the authentication key.
- **RSA is being displaced.** **ECDSA/EdDSA** give equivalent strength at far smaller key sizes (a 256-bit EC key ≈ RSA-3072) and **ECDH** is the standard key agreement in TLS 1.3. Post-quantum migration (ML-KEM / ML-DSA, FIPS 203/204) affects **RSA and ECC, not AES-256** — Grover's algorithm only halves symmetric strength, which is why AES-256 is already treated as quantum-resistant while RSA is not.

---

## Q5. Symmetric vs asymmetric encryption?

The general form of Q4, and the trade-off is one sentence: **symmetric is fast but cannot solve key distribution; asymmetric solves key distribution but is slow and size-limited.**

| Dimension | **Symmetric** | **Asymmetric** |
|---|---|---|
| **Key model** | One shared secret | Public/private key pair |
| **Performance** | Very fast, hardware-accelerated | Orders of magnitude slower |
| **Key distribution** | Requires a pre-existing secure channel | Public key needs no confidentiality — only authenticity |
| **Keys for *n* parties** | **n(n−1)/2** — 1,000 parties ≈ 500,000 keys | **2n** — one pair each |
| **Non-repudiation** | **No** — either party could have produced the message | **Yes** — only the private-key holder could have signed |
| **Algorithms** | AES, ChaCha20, 3DES (deprecated) | RSA, ECDSA, EdDSA, ECDH, ML-KEM |

**The two properties only asymmetric crypto provides**, and this is the part candidates miss:

1. **Key distribution without a prior shared secret** — you can hand your public key to an anonymous internet client.
2. **Non-repudiation.** With a shared symmetric key *both* parties can generate a valid MAC, so neither can prove the other produced a message. With a signature, only the private-key holder could have. That is why **webhook signing, JWT `RS256`/`ES256`, code signing and certificates are all asymmetric.** If a dispute could end up in front of a regulator, you need a signature, not a MAC.

**Where each lands in a real financial platform:**

| Control | Primitive |
|---|---|
| TLS session traffic | **Symmetric** (AES-GCM), after an **asymmetric** ECDHE handshake |
| Database TDE / column encryption | Symmetric AES-256, key wrapped asymmetrically or held in KMS/HSM |
| S3, EBS, RDS at rest | Symmetric AES-256 via KMS envelope encryption |
| JWT signing between services | Asymmetric (`RS256`/`ES256`) — issuer signs, every service verifies from JWKS, **no shared secret to distribute across n services** |
| Internal HMAC of a short-lived cache key | Symmetric (HMAC-SHA-256) — fast, no non-repudiation needed |
| mTLS workload identity | Asymmetric — each workload holds a private key and presents a certificate |
| Partner file exchange (PGP/SWIFT-style) | Hybrid: asymmetric key wrap + symmetric bulk |

**The `HS256` vs `RS256` question follows directly from this table**, and is the practical form interviewers usually ask. `HS256` is symmetric: every service that *verifies* a token also holds the key that can *mint* one, so any compromised service can forge an admin token for the whole estate. `RS256` splits the capability — the IdP signs, everyone else only verifies. **Use asymmetric signing whenever the verifier is not in the same trust domain as the issuer.**

---

## Q6. What is key rotation?

**Replacing a cryptographic key with a new one on a defined schedule or in response to an event, while keeping previously protected data readable.** NIST SP 800-57 frames it in terms of a key's **cryptoperiod** — the bounded time a key may be used — and the reasoning is not that keys "wear out":

| Reason | Explanation |
|---|---|
| **Limit the blast radius** | A key compromised today exposes only the data encrypted during its cryptoperiod, not ten years of history |
| **Limit ciphertext volume per key** | The more ciphertext produced under one key, the more material an attacker has for cryptanalysis; AES-GCM also has a hard birthday-bound on invocations per key |
| **Limit exposure window** | The longer a key lives, the more systems, backups, laptops and log files it has leaked into |
| **Compliance** | PCI DSS Requirement 3 mandates a defined cryptoperiod and key changes at its end; auditors ask for evidence of the last rotation |
| **Personnel change** | A DBA leaves; any key they could have extracted must be considered exposed |

**The critical distinction interviewers probe: rotation ≠ re-encryption.**

- **Rotation** = start using a *new* key for *new* operations. Old keys are retained in a **decrypt-only** state so historical data stays readable.
- **Re-encryption (rekeying)** = decrypt everything under the old key and re-encrypt under the new one. Expensive, and required only when the old key is actually **compromised**.

A key's lifecycle therefore has states, and your data model must carry a **key identifier alongside every ciphertext** — otherwise you cannot rotate at all, because you will not know which key decrypts which row:

```text
Pre-activation -> Active (encrypt + decrypt) -> Deactivated (decrypt only) -> Destroyed
```

```sql
CREATE TABLE customer_pii (
    customer_id   BIGINT       PRIMARY KEY,
    national_id   VARBINARY(MAX) NOT NULL,   -- ciphertext
    key_id        VARCHAR(64)    NOT NULL,   -- WHICH key encrypted it  <- essential
    encrypted_at  DATETIME2      NOT NULL
);
```

**How AWS KMS does it, because this is the concrete answer.** Enabling automatic rotation on a KMS key rotates the **backing key material annually** (or on a configurable 90–2560 day period) while the **key ID and ARN stay the same**. New encryptions use the new material; old material is retained so old ciphertext still decrypts, and **you do not re-encrypt anything**. That is the "keep the same logical key, rotate the material underneath" model, and it is why applications referencing a KMS key by ARN need no code change. Envelope encryption amplifies this: rotating the KMS key means re-wrapping data keys, not re-encrypting terabytes of data.

**Rotation applies to more than encryption keys**, and the answer is stronger if you list them: database credentials (Q9), API keys, JWT signing keys (publish both old and new in the JWKS during the overlap so in-flight tokens still verify), TLS certificates, HMAC webhook secrets (accept both during a window), and ASP.NET Core Data Protection keys (rotated automatically every 90 days by default, with old keys retained for decryption).

**The operational rule that makes rotation actually possible:** every consumer must accept **N and N−1** simultaneously. A rotation that requires a synchronised flag-flip across all services is a rotation nobody will ever perform, which is how organisations end up with a five-year-old key nobody dares touch.

---

## Q7. What is KMS?

A **Key Management Service** is a managed service that **creates, stores, controls access to, audits and rotates cryptographic keys, with the private key material never leaving the service**. AWS KMS is the reference implementation; Azure Key Vault / Managed HSM and Google Cloud KMS are equivalents.

**The core design property, and the one to lead with:** **you never receive the key.** You send KMS a small blob and it returns the transformed blob. The key material is generated in and confined to **FIPS 140-3 validated hardware security modules**, and there is no API that exports it. This means a compromised application server, a stolen database backup and a leaked log file all fail to yield the key.

**The main operations:**

| Operation | Purpose |
|---|---|
| `Encrypt` / `Decrypt` | Direct crypto on **small** payloads (KMS caps at **4 KB**) |
| `GenerateDataKey` | Returns a **plaintext data key + the same key encrypted under the KMS key** — the basis of envelope encryption |
| `Sign` / `Verify` | Asymmetric signing with a key that never leaves the HSM |
| `GenerateMac` | HMAC with an HSM-resident key |
| `ReEncrypt` | Move ciphertext from one KMS key to another without exposing plaintext |

**Envelope encryption is the pattern to describe**, because the 4 KB limit forces it and because it is how every AWS service encrypts your data underneath:

```text
Write path:
  GenerateDataKey(keyId)  ->  { PlaintextKey, EncryptedKey }
  ciphertext = AES-256-GCM(PlaintextKey, payload)
  wipe PlaintextKey from memory
  store: EncryptedKey + ciphertext + nonce + tag

Read path:
  PlaintextKey = Decrypt(EncryptedKey)        <- one small KMS call
  payload      = AES-256-GCM-Decrypt(PlaintextKey, ciphertext)
```

You can cache the decrypted data key briefly (the AWS Encryption SDK has a data-key caching policy bounded by messages, bytes and age) to cut KMS calls and cost on high-throughput paths — a legitimate trade of a short in-memory exposure window against latency and spend.

**What you actually get from a KMS that a config-file key cannot give you:**

- **Access control as IAM policy** — decryption becomes an authorisation decision, revocable instantly, separable by role. The **key policy** plus **grants** let you say "the settlement service may `Decrypt` but never `Encrypt`, only from within this VPC endpoint."
- **A full audit trail** — every `Decrypt` lands in CloudTrail with caller identity, source IP and timestamp. That log is what turns "who read the card data?" from unanswerable into a query, and is exactly what an auditor asks for.
- **Automatic rotation** (Q6) with no application change.
- **Separation of duties** — a DBA with full database access still cannot read encrypted columns, because the decrypt permission is a separate IAM grant they do not hold. This is the single most valuable property in a regulated environment.
- **Encryption context** — additional authenticated data (e.g. `{"customer_id":"914"}`) bound into the ciphertext and into CloudTrail, so a ciphertext lifted from one record cannot be decrypted in the context of another.

**Design notes worth stating:** use **customer-managed keys (CMKs)** rather than AWS-managed keys wherever you need your own key policy, rotation schedule or the ability to **deny** access; **multi-Region keys** where a DR region must decrypt the same ciphertext; and remember that **scheduling key deletion is irreversible after the 7–30 day waiting period** — deleting a key destroys every ciphertext under it, which is simultaneously the biggest operational risk and the basis of crypto-shredding (Q17).

---

## Q8. Encryption at rest vs encryption in transit?

Two different threat models, and **both are mandatory** — PCI DSS, GDPR Article 32 and every bank's control framework require each.

| | **At rest** | **In transit** |
|---|---|---|
| **Protects against** | Stolen disk, stolen backup/snapshot, decommissioned hardware, a copied database file, an over-permissive S3 bucket | Network eavesdropping, man-in-the-middle, ARP/DNS spoofing, a compromised load balancer or sniffing sidecar |
| **Mechanism** | AES-256 applied to files, volumes, tables or columns | TLS 1.2+ (prefer 1.3), mTLS for service-to-service |
| **Typical implementation** | RDS/EBS/S3 encryption with KMS, SQL Server TDE, Always Encrypted | HTTPS, `Encrypt=True` on the connection string, service-mesh mTLS |
| **Cost** | Near zero — hardware-accelerated | Small handshake cost, amortised by connection reuse |
| **The gap it leaves** | Data is plaintext **once loaded into memory or returned to a client** | Data is plaintext **at both endpoints** |

**The point that shows real understanding: what at-rest encryption does *not* protect against.**

**Transparent Data Encryption (TDE)** — SQL Server, Azure SQL, RDS — encrypts **data files, log files and backups on disk**. It is transparent because the engine decrypts pages as they are read into the buffer pool. Therefore:

- A **stolen `.mdf` file or backup** is useless — **this is exactly the threat TDE exists for**, and it is a real one, since backups are copied, shipped and mislaid far more often than live databases are stolen.
- But **SQL injection still returns plaintext.** A DBA with `db_datareader` still reads everything. A compromised application connection still reads everything. **TDE does not defend against anyone who reaches the database through the database.**

That distinction is the reason a serious design layers a third state:

| Layer | Protects against | Blind spot |
|---|---|---|
| **In transit** (TLS/mTLS) | Network attacker | Both endpoints |
| **At rest** (TDE, EBS/S3/RDS encryption) | Stolen media and backups | Any authenticated query path |
| **In use / application-level** (Always Encrypted, envelope encryption in the app, tokenisation) | **DBAs, SQL injection, compromised database, cloud-provider staff** | Key management complexity; breaks range queries, `LIKE`, and most indexing |

**Always Encrypted** is the concrete example of that third layer: the .NET client driver holds the column encryption key and encrypts **before** the value leaves the application, so the database engine only ever sees ciphertext. It genuinely defends against a malicious DBA — at the price that equality comparison requires deterministic encryption (which leaks equality patterns) and range queries require the enclave-based variant.

**A practical checklist for AWS, since interviewers usually push for specifics:** RDS storage encryption enabled **at creation** (it cannot be turned on in place — you snapshot, copy the snapshot with encryption, restore); `rds.force_ssl` / `require_secure_transport` on so unencrypted connections are refused rather than merely discouraged; S3 default bucket encryption plus a bucket policy denying `s3:PutObject` without it, and a policy denying any request where `aws:SecureTransport` is `false`; EBS encryption-by-default on at the account level; and remember that **snapshots, read replicas and cross-region copies inherit encryption but need the key to exist in the target region.**

---

## Q9. How do you protect database credentials?

**By not having a long-lived static credential at all, wherever the platform allows it.** The answer is a ladder, and you should present it as one, because it shows you know both the ideal and the pragmatic middle rung.

| Rung | Approach | Verdict |
|---|---|---|
| 0 | Connection string in `appsettings.json`, committed to git | **Never.** It leaks to every developer laptop, every CI log, every fork and every container image layer |
| 1 | Environment variables set by hand | Better than git, but visible in `docker inspect`, process listings, crash dumps and orchestrator manifests; no rotation, no audit |
| 2 | **Secrets Manager / Key Vault / Parameter Store (SecureString)** | Good. Encrypted with KMS, IAM-controlled, CloudTrail-audited, **automatically rotated** |
| 3 | **IAM database authentication** (RDS/Aurora) | Better. The application requests a **15-minute** signed token instead of a password |
| 4 | **Managed identity** (Azure) or **IRSA / Pod Identity** (EKS) | **Best.** No credential exists to steal — identity is derived from the workload itself |

**Rung 3, concretely**, because it is the one candidates rarely name and it impresses when they do. Enable IAM authentication on the RDS instance, create the database user with `rds_iam`, then:

```csharp
// The "password" is a signed, short-lived token — nothing durable is stored anywhere
var token = RDSAuthTokenGenerator.GenerateAuthToken(host, port, dbUser);
var csb = new NpgsqlConnectionStringBuilder(baseConnectionString)
{
    Password = token,
    SslMode  = SslMode.VerifyFull   // required: the token is bearer material
};
```

There is no password in the vault, no rotation job, no shared secret — the credential expires in 15 minutes and is minted from the pod's IAM role. Note the connection-pooling consequence to mention: tokens expire, so the pool must refresh them, which is why this suits Aurora with RDS Proxy (which holds the real credential in Secrets Manager and pools connections centrally) better than a naive `DbContext` pool.

**Rung 2 done properly** — the part that matters is **choosing the right rotation strategy for the availability requirement**. AWS Secrets Manager ships two Lambda rotation templates: **single-user** rotation changes one user's password in place — the simplest option, and AWS's own recommendation for ad hoc or interactive credentials — but there is a short window between the database password changing and the secret being updated where a client using the just-rotated-out credential can be denied; **alternating-users** rotation maintains two database users (the rotation function clones the first user into a second on its first run) and switches which one the secret points to on each rotation, so one user always holds a currently valid credential while the other is being updated. **Use alternating-users wherever high availability matters** — a payments service should never fail a request because rotation happened to run at that moment. Naming that difference, and which one you would choose for a production service credential, is the detail that shows real operational experience.

**The application-side rules, regardless of rung:**

- **Fetch at startup and cache with a bounded TTL**, and **handle rotation** — on an authentication failure, re-fetch the secret once and retry before failing the request. Applications that read the secret only at boot silently break at the next rotation.
- **Never log the connection string.** `DbException` messages and `ILogger` scopes have leaked credentials in real incidents; scrub them (Q15).
- **Least privilege on the database user itself** — the application user should have `SELECT/INSERT/UPDATE` on its own schema, not `db_owner`, not `rds_superuser`, and no `DROP`. This is what limits what a successful SQL injection can actually do (Q10).
- **Separate credentials per service and per environment** — never one shared "app user" across the estate, or you cannot revoke one service without breaking all of them.
- **Use `dotnet user-secrets` in development** so the pattern of "not in the repo" starts on day one.

---

## Q10. How do you prevent SQL Injection?

Module 16 Q10–Q12 covers the code-level prevention in .NET — parameterised commands, EF Core's automatic parameterisation, and `FromSqlInterpolated` vs `FromSqlRaw`. **The database-side answer is the defence-in-depth layer underneath it**, and it is what an architect is expected to add.

**Layer 1 — parameterisation (the actual fix).** Parameters are transmitted to the server **out of band from the SQL text**, so the query plan is fixed before any user value is seen. There is no escaping to get wrong. Recapped in one line: `cmd.Parameters.Add(new SqlParameter("@id", SqlDbType.BigInt) { Value = id })`, or simply let EF Core do it.

**Layer 2 — least privilege on the database principal.** This is the control that decides how bad a successful injection is:

```sql
-- The application user can read and write its own data, and nothing else
CREATE USER app_payments WITHOUT LOGIN;
GRANT SELECT, INSERT, UPDATE ON SCHEMA::payments TO app_payments;
DENY  DELETE, ALTER, CREATE, EXECUTE ON SCHEMA::sys TO app_payments;
-- no db_owner, no xp_cmdshell, no linked servers, no access to other schemas
```

With this in place, an injection that reaches the database can read the payments schema — serious — but cannot drop tables, cannot pivot into the customer schema, cannot enumerate `sys.databases`, and cannot reach the OS. **Separate read-only and read-write users**, and point reporting and query-side (CQRS read model) workloads at the read-only one.

**Layer 3 — stored procedures, with the caveat that catches people out.** Stored procedures help because they let you grant `EXECUTE` on the procedure and *no* table permissions at all (ownership chaining). But **a stored procedure is not inherently safe** — dynamic SQL inside one is just as injectable:

```sql
-- VULNERABLE, despite being "a stored procedure"
CREATE PROCEDURE dbo.FindAccounts @filter NVARCHAR(200) AS
    EXEC('SELECT * FROM accounts WHERE name LIKE ''%' + @filter + '%''');

-- SAFE: sp_executesql parameterises the dynamic statement
CREATE PROCEDURE dbo.FindAccounts @filter NVARCHAR(200) AS
    EXEC sp_executesql
        N'SELECT * FROM accounts WHERE name LIKE @p',
        N'@p NVARCHAR(202)',
        @p = '%' + @filter + '%';
```

**Layer 4 — what cannot be parameterised.** Table names, column names, `ORDER BY` targets and `ASC`/`DESC` are **identifiers, not values**, and no parameter mechanism covers them. The only safe handling is an **allow-list mapping** from a client-supplied token to a hard-coded identifier — never string concatenation, never "sanitising" the input:

```csharp
private static readonly Dictionary<string, string> SortColumns = new()
{
    ["date"]   = "settlement_date",
    ["amount"] = "amount_minor",
};
if (!SortColumns.TryGetValue(request.SortBy, out var column))
    return BadRequest();               // reject, do not sanitise
var sql = $"SELECT ... ORDER BY {column} {(request.Desc ? "DESC" : "ASC")}";
```

**Layer 5 — detection and containment.** SQL Server / Azure SQL **Advanced Threat Protection** alerts on injection-shaped activity; database auditing (Q14) records what was executed; a **WAF** (AWS WAF's SQLi rule set) removes the low-effort automated traffic before it reaches the origin. None of these are the fix — they are the tripwire for the case where the fix was missed on one endpoint.

**The architect's summary:** parameterise to prevent it, grant least privilege to bound it, audit to detect it, and treat WAF as noise reduction rather than protection. And note the **second-order variant** interviewers like: data read from the database and then concatenated into another query is still user input — injection does not have to arrive directly from the HTTP request.

---

## Q11. What is Row-Level Security?

**A database-enforced predicate that filters the rows a given principal can see or modify, applied automatically by the engine to every query against the table** — regardless of which application, query or tool issued it.

**The problem it solves.** Multi-tenancy and need-to-know filtering are normally enforced in application code:

```csharp
// Correct — but only if EVERY query remembers it
var trades = db.Trades.Where(t => t.TenantId == _ctx.TenantId).ToList();
```

One forgotten `Where` in one repository method, one ad-hoc report, one background job, one DBA running a query by hand, and tenant A sees tenant B's trades. **RLS moves that predicate from n call sites down to one place the engine enforces**, which is the difference between a convention and a control.

**SQL Server / Azure SQL implementation:**

```sql
CREATE FUNCTION security.fn_tenant_predicate(@TenantId INT)
    RETURNS TABLE WITH SCHEMABINDING
AS RETURN
    SELECT 1 AS ok
    WHERE @TenantId = CAST(SESSION_CONTEXT(N'TenantId') AS INT)
       OR IS_MEMBER('BackOfficeAdmin') = 1;   -- deliberate escape hatch

CREATE SECURITY POLICY security.TenantIsolation
    ADD FILTER PREDICATE security.fn_tenant_predicate(TenantId) ON dbo.Trades,
    ADD BLOCK  PREDICATE security.fn_tenant_predicate(TenantId) ON dbo.Trades AFTER INSERT
    WITH (STATE = ON);
```

Two predicate kinds, and the distinction is exam-worthy:

- **FILTER predicate** — silently removes rows from `SELECT`, `UPDATE`, `DELETE`. The caller sees an empty result, not an error.
- **BLOCK predicate** — raises an error on `INSERT`/`UPDATE` that would write a row the caller could not then read. **Without a BLOCK predicate, a tenant can insert rows belonging to another tenant** — a gap people miss.

The application sets the context per connection, immediately after opening it:

```csharp
await using var conn = new SqlConnection(cs);
await conn.OpenAsync(ct);
await conn.ExecuteAsync(
    "EXEC sp_set_session_context @key=N'TenantId', @value=@t, @read_only=1",
    new { t = _tenantContext.TenantId });
```

`@read_only=1` matters: it prevents anything later in the session from overwriting the tenant id.

**PostgreSQL equivalent**, which is worth knowing because the semantics differ slightly:

```sql
ALTER TABLE trades ENABLE ROW LEVEL SECURITY;
ALTER TABLE trades FORCE ROW LEVEL SECURITY;      -- also applies to the table owner
CREATE POLICY tenant_isolation ON trades
    USING (tenant_id = current_setting('app.tenant_id')::int)
    WITH CHECK (tenant_id = current_setting('app.tenant_id')::int);
```

`USING` is the read filter, `WITH CHECK` is the write constraint — the direct analogue of FILTER and BLOCK. **`FORCE ROW LEVEL SECURITY` is the trap**: without it, the table owner and superusers bypass the policy entirely, so a policy that looks enforced silently is not for the very accounts most likely to be misused.

**The critical caveat with connection pooling** — the reason RLS goes wrong in .NET services. Connections are pooled and reused across requests. If request 1 sets `TenantId = 7` and request 2 gets that same pooled connection without setting the context, it inherits tenant 7. **Set the session context on every connection open, without exception** (an EF Core `DbConnectionInterceptor` on `ConnectionOpenedAsync` is the right place), and never rely on it persisting.

**Where RLS fits and where it does not:** it is excellent as a **safety net beneath** application-level authorization, for regulatory need-to-know (a trader sees only their desk's book), and for shared-schema multi-tenancy. It is not a substitute for API-level object authorization (Module 16 Q3 — BOLA), it adds a predicate to every query plan so it has a **measurable performance cost** (index the predicate column), and complex predicates involving lookups can degrade plans badly. And it does not encrypt anything — a principal who can change the session context sees everything.

---

## Q12. How do you protect PII?

Not with one control — with a **lifecycle**, and the strongest answer is structured as one, because PII protection fails at the edges (logs, backups, lower environments, analytics extracts) far more often than in the primary datastore.

**Step 1 — Know what you hold. Classify and inventory.** You cannot protect data you have not located. Maintain a **data catalogue** mapping each field to a classification (Public / Internal / Confidential / Restricted), a legal basis, an owner and a retention period. Automate the discovery: **AWS Macie** scans S3 for PII patterns, **SQL Data Discovery & Classification** labels columns in SQL Server, and both surface the copies nobody remembered — the CSV export in a scratch bucket, the ten-year-old backup, the analytics extract.

**Step 2 — Minimise. The best protection is not holding it.** GDPR's data-minimisation principle is also the cheapest engineering control: do you need full date of birth, or only "over 18"? The full PAN, or the last four? A stored copy, or a reference to the system of record? **Every field you delete is a field that cannot leak, cannot be mis-permissioned, and does not appear in a breach notification.**

**Step 3 — Tokenise or pseudonymise the highest-risk fields.** Replace the sensitive value with a surrogate that has **no mathematical relationship** to the original, with the mapping held in a separate, tightly controlled vault:

```text
PAN 4111 1111 1111 1111  ->  tok_9f3a2c7e41d8   (stored everywhere in the estate)
                             the vault alone can reverse it
```

The payoff is **scope reduction**: with tokenisation and a hosted payment page, the systems handling tokens fall largely outside PCI DSS scope, which is a cost and audit argument, not just a security one. GDPR similarly treats **pseudonymisation** as a recognised safeguard. Note the distinction: pseudonymised data is still personal data (it can be re-linked); **anonymised** data — irreversibly, including against re-identification by combination — is out of scope entirely, and true anonymisation is much harder than dropping the name column.

**Step 4 — Encrypt what you must keep.** At rest, in transit and, for the highest-sensitivity columns, **in use** (Q8): Always Encrypted or application-side envelope encryption so DBAs and the database itself never see plaintext. Use a **per-tenant or per-subject data key** where you may later need crypto-shredding (Q17).

**Step 5 — Control access, and make it accountable.** Least-privilege IAM and database grants; **RLS** (Q11) for need-to-know; **dynamic data masking** (Q13) so support staff see `XXXX-1234`; break-glass access that is time-boxed, approved and alarmed rather than standing. **Every read of restricted data should be logged with the identity that performed it** (Q14) — in a bank, the ability to answer "who looked at this customer's record, and why?" is a hard requirement, not a nice-to-have.

**Step 6 — Stop the leaks at the edges**, which is where PII incidents actually originate:

| Edge | Control |
|---|---|
| **Logs** | Never log PII; redact structurally (Q15) |
| **API responses** | Explicit response DTOs — never return the entity (Module 16 Q5) |
| **Error messages / stack traces** | Problem Details with no internals (Module 16 Q20) |
| **Lower environments** | **Never copy production data to test.** Mask or synthesise it |
| **Analytics / data lake** | Pseudonymise on the way in, not on the way out |
| **Backups** | Encrypted, access-controlled, retention-bounded (Q18) |
| **Third parties** | Contractual DPAs, minimum necessary fields, no bulk export |
| **Support tooling** | Masked by default; unmasking is a logged, justified action |

**Step 7 — Honour the data-subject rights that turn into engineering work.** Access/portability (export everything you hold about a subject — which requires the catalogue from step 1), rectification, **erasure** (Q17), and breach notification within 72 hours (which requires the audit trail from step 6 to determine scope). Design the deletion path *before* you need it: a "right to be forgotten" request that requires a manual sweep of nine microservices, a data lake and seven years of backups is a design failure discovered at the worst moment.

---

## Q13. What is data masking?

**Replacing sensitive values with realistic but non-sensitive substitutes**, so a viewer or an environment gets usable data without the real thing. The essential split is **dynamic** (masked at read time, source unchanged) versus **static** (masked when copying, producing a permanently sanitised dataset).

| | **Dynamic masking** | **Static masking** |
|---|---|---|
| **When** | At query time, per principal | Once, during an extract or refresh |
| **Source data** | Unchanged — still the real value | The copy contains **only** masked values |
| **Reversible** | Yes, by a privileged principal | **No** — that is the point |
| **Use** | Support screens, call-centre views, production read access | Populating dev/test/UAT, analytics sandboxes, vendor extracts |
| **Tools** | SQL Server Dynamic Data Masking, view-based masking, app-layer masking | ETL/masking pipeline, Data Masking in SSDT-style tooling, custom scripts |

**Dynamic Data Masking in SQL Server:**

```sql
ALTER TABLE customers ALTER COLUMN email
    ADD MASKED WITH (FUNCTION = 'email()');            -- aXX@XXXX.com
ALTER TABLE customers ALTER COLUMN national_id
    ADD MASKED WITH (FUNCTION = 'partial(0, "XXX-XX-", 4)');   -- XXX-XX-6789
ALTER TABLE accounts  ALTER COLUMN balance
    ADD MASKED WITH (FUNCTION = 'random(1, 100)');

GRANT UNMASK TO [BackOfficeSupervisor];   -- everyone else sees the mask
```

**The limitation you must state, or the answer is naive.** Microsoft's own documentation is explicit that DDM is **not a strong isolation control**: it masks in the result set but the **predicate still runs against the real value**, so a user with query access can infer the data by brute force:

```sql
SELECT COUNT(*) FROM customers WHERE national_id = 'AB123456C';  -- 1 = confirmed
SELECT * FROM accounts WHERE balance BETWEEN 1000000 AND 2000000; -- binary search
```

**DDM prevents accidental exposure on a screen; it does not defend against a determined user with ad-hoc query rights.** Layer it with RLS (Q11), least privilege, and — for genuine protection against the database itself — Always Encrypted (Q8). Presenting DDM as a security boundary is the mistake; presenting it as a **usability control that reduces casual exposure** is the correct framing.

**Static masking, which is where the real risk lives.** Copying production data into UAT is one of the most common serious data incidents in financial services: the lower environment has weaker access control, more developers, looser network policy and no audit trail. **The rule is that production data never lands in a non-production environment unmasked.** A good masking pipeline must preserve:

| Property | Why it matters |
|---|---|
| **Format and validity** | A masked IBAN must still pass IBAN validation, or the test is invalid |
| **Referential integrity** | The same customer must mask to the same surrogate **across every table and every service**, or joins break — use deterministic, keyed masking |
| **Distribution** | Keep realistic cardinality and skew, or performance testing is meaningless |
| **Irreversibility** | No mapping table shipped alongside the masked copy |
| **Uniqueness** | Masked values in a unique column must stay unique |

**The alternative worth naming: synthetic data.** Generating data that never derived from a real person removes the risk class entirely, at the cost of realism — usually the right answer for functional testing, while masked production copies remain necessary for performance testing at true scale and for reproducing production-only defects.

---

## Q14. How do you implement audit logging?

**An audit log is a tamper-evident, append-only record of who did what, to what, when, from where, and with what outcome — retained for a regulator-defined period.** It is a different artefact from application logging, and conflating the two is the most common mistake.

| | **Application logging** | **Audit logging** |
|---|---|---|
| **Audience** | Engineers debugging | Regulators, auditors, forensic investigators, legal |
| **Content** | Whatever helps diagnose | A defined schema of security- and business-significant events |
| **Retention** | Days to weeks | **Years** — SOX ~7, PCI DSS ≥ 1 year with 3 months immediately available |
| **Mutability** | Rotated, dropped, sampled freely | **Immutable and append-only** |
| **Loss tolerance** | Acceptable | **Not acceptable** — a lost audit record is a control failure |
| **Store** | ELK / CloudWatch | Separate account/store with restricted write-once access |

**What to record.** The minimum event schema:

```jsonc
{
  "event_id":    "0f4c…",                  // unique, for de-duplication
  "occurred_at": "2026-09-08T14:22:31.472Z",// UTC, from a trusted clock
  "actor":       { "sub": "u-914", "type": "user", "on_behalf_of": null },
  "source":      { "ip": "…", "user_agent": "…", "session_id": "…" },
  "action":      "payment.approved",        // verb from a controlled vocabulary
  "resource":    { "type": "payment", "id": "p-77213" },
  "outcome":     "success",                 // success | failure | denied
  "before":      { "status": "PENDING_APPROVAL" },
  "after":       { "status": "APPROVED" },
  "correlation_id": "trace-abc123",         // ties to the distributed trace
  "reason":      "four-eyes approval, ticket CHG-4471"
}
```

**Failed and denied attempts matter as much as successes** — an authorization denial is precisely what an investigation looks for. And the event set must cover **authentication (success and failure), authorization denials, privilege and role changes, access to restricted data, configuration and permission changes, exports, and the business events the regulator cares about** (payment approved, limit overridden, account closed).

**Where to produce it — three viable layers, usually combined:**

1. **Application layer** — the only place with business meaning ("four-eyes approval of payment p-77213 by user u-914"). Emit explicitly; do not infer it from HTTP logs.
2. **Database layer** — **SQL Server Audit** / Azure SQL auditing / PostgreSQL `pgaudit` catch what bypasses the application, including a DBA connecting with SSMS. This is what answers "did anyone query this table outside the app?"
3. **Infrastructure layer** — **CloudTrail** for every AWS API call (including every KMS `Decrypt`), VPC flow logs, EKS audit logs.

**Making it tamper-evident, which is the part that distinguishes an audit log from a table of rows:**

- **Append-only by permission** — the application principal has `INSERT` and no `UPDATE`/`DELETE`; ideally it writes to a different account or store than the one it can administer.
- **Hash chaining** — each record includes the hash of its predecessor, so any modification or deletion breaks the chain and is detectable. **SQL Server Ledger** implements exactly this natively (Merkle tree, with digests optionally published to immutable storage), and is the answer to "how do you prove the audit log was not altered?"
- **Write-once storage** — **S3 Object Lock in compliance mode** (or CloudWatch Logs with a restrictive resource policy) prevents deletion even by an account administrator for the retention period. **CloudTrail log file validation** provides the same property for AWS API history.
- **Separate blast radius** — ship audit records to a **separate AWS account** whose write role the production account can assume but whose delete permissions it does not hold. An attacker who owns production must not be able to erase the evidence.

**Reliability.** Because a lost audit record is a control failure, do not fire-and-forget over the network. Write the audit record **in the same database transaction as the business change** (or via the **outbox pattern** — Module 14) and ship it asynchronously. That way the audit entry and the state change commit atomically: you can never have an approved payment with no record of who approved it.

**And what must never appear in it:** passwords, tokens, full PANs, plaintext PII beyond the identifiers needed to establish who and what. An audit log is a high-value target precisely because it aggregates activity, so it inherits the classification of the most sensitive thing you put in it.

---

## Q15. How do you prevent sensitive information from entering logs?

**By making redaction structural rather than a matter of developer discipline**, because "remember not to log the request object" fails at scale — one `_logger.LogInformation("Request: {@Request}", req)` written under deadline pressure puts card numbers into a log store with 200 readers and a five-year retention.

**How data actually leaks into logs, in descending order of frequency:**

| Leak | Example |
|---|---|
| **Structured logging of a whole object** | `LogInformation("{@Command}", cmd)` serialises every property, including new ones added later |
| **Exception messages and stack traces** | A `DbException` carrying the connection string; a validation exception echoing the value |
| **Full request/response logging middleware** | Enabled "temporarily" for debugging and never removed |
| **URLs with query strings** | `GET /api/customers?ssn=…` lands in access logs, proxy logs, CloudFront logs, browser history |
| **Third-party SDK debug logging** | An HTTP client logging `Authorization` headers at `Debug` |
| **Verbose EF Core logging** | `EnableSensitiveDataLogging()` left on outside development — it logs **parameter values** |

**The controls, layered:**

**1. Never log an entity or a raw request object.** Log named, explicitly chosen fields. If a type must be loggable, give it a `ToString()`/destructuring policy that emits only safe fields — then a new sensitive property added next year is excluded by default rather than included by default. **Default-deny, not default-allow.**

**2. Type the sensitivity into the domain.** A value object that cannot be printed is the most reliable control there is:

```csharp
public readonly record struct Pan
{
    private readonly string _value;
    public Pan(string value) => _value = value;
    public string Last4 => _value[^4..];
    public override string ToString() => $"****{Last4}";   // safe by construction
}
```

Now `LogInformation("{Card}", pan)` is harmless everywhere, forever, without anyone remembering a rule.

**3. Redact in the pipeline as a backstop.** Serilog destructuring policies / masking enrichers, or .NET 8's **`Microsoft.Extensions.Compliance.Redaction`** with `[PersonalData]`/`[SensitiveData]` data-classification attributes, apply redaction centrally in the logging pipeline. Combine with a **regex-based scrubber for known formats** (PAN with a Luhn check, IBAN, JWT `eyJ…`, AWS access-key ids, `password=` in a connection string) at the sink, so anything the earlier layers missed is caught before it is persisted.

**4. Configure the framework correctly.**

```csharp
// EF Core — must never be on outside local development
if (env.IsDevelopment()) options.EnableSensitiveDataLogging();

// HttpClient logging: strip auth headers
services.Configure<HttpClientFactoryOptions>(o =>
    o.HttpClientActions.Add(_ => { /* filter Authorization, Cookie, X-Api-Key */ }));
```

Also: keep sensitive values **out of URLs** entirely (body or header, never query string), and disable request-body logging in production middleware.

**5. Defend the log store as a data store.** It holds a superset of production data by volume. Encrypt it, apply least-privilege access, retain for a bounded period, and audit reads of it. Point **Macie** or an equivalent scanner at log buckets — the first time you do this on a mature estate it will find something.

**6. Test for it.** A CI check that greps for `EnableSensitiveDataLogging`, `LogXxx("{@`, and known field names is cheap. Better: a test that exercises the logging pipeline with a synthetic card number and asserts it never appears in the sink output.

**And the incident-response point worth making:** once a secret is in a log store it is **compromised**, not merely exposed — it has been replicated to backups, indexes and possibly a SIEM in another region. The response is **rotate the credential**, not "delete the log line."

---

## Q16. How do you handle data retention?

**Retention is a policy decision with an engineering implementation, and it cuts both ways**: regulation requires you to keep some data for years, and simultaneously requires you not to keep other data any longer than necessary. Holding everything forever is not the safe default — under GDPR it is a violation, and it enlarges every breach.

**The two opposing forces, which is the framing to open with:**

| Force | Source | Effect |
|---|---|---|
| **Must retain** | SOX (~7 years), MiFID II (5–7 years for communications and order records), PCI DSS (≥1 year of logs), AML/KYC (5 years after relationship ends), tax law | Minimum retention |
| **Must delete** | GDPR storage-limitation principle, right to erasure, CCPA | Maximum retention |

Where they conflict, **the legal obligation to retain generally overrides an erasure request** — GDPR Article 17(3)(b) exempts processing required for a legal obligation. The correct engineering behaviour for "delete my account" on a customer with regulated transaction history is therefore **not** to delete the transactions: it is to delete or pseudonymise the marketing and profile data, retain the regulated records under a documented legal basis, and record the decision. Being able to state that distinction is what separates an architect from someone who wired up a `DELETE` statement.

**Implementation, in order:**

**1. A retention schedule per data class, in the catalogue** (Q12) — not per table, per *class*: transaction records 7 years, KYC documents 5 years after closure, application logs 90 days, marketing preferences until withdrawn, session data 24 hours. Each entry names the legal basis, the owner and the disposition (delete / anonymise / archive).

**2. Retention as a property of the data, enforced automatically.** Store an explicit expiry, and let the platform act on it, so nothing depends on a job somebody remembers to write:

| Store | Mechanism |
|---|---|
| **DynamoDB** | **TTL attribute** — items deleted automatically, no cost, no scan |
| **S3** | **Lifecycle policies** — transition to Glacier at 90 days, expire at 7 years; plus Object Lock where immutability is required |
| **CloudWatch Logs** | Per-log-group retention setting (**the default is Never Expire — a real and common cost and compliance problem**) |
| **Redis** | Native `EXPIRE`/TTL |
| **SQL Server / PostgreSQL** | Partition by time and **drop whole partitions** — vastly cheaper than `DELETE` over billions of rows and it reclaims space immediately |
| **Kafka** | `retention.ms` per topic; compacted topics need a tombstone to actually remove a key |

**3. Tiering, because retention and accessibility are separate decisions.** Hot (queryable, expensive) → warm → cold archive (Glacier Deep Archive, retrieval in hours). A seven-year obligation does not mean seven years of provisioned IOPS; it means seven years of retrievability. This is usually the single largest storage-cost saving available on a mature platform.

**4. Do not forget the copies.** A retention policy applied only to the primary database is fiction. **Backups, read replicas, snapshots, the data lake, search indexes, caches, DR copies, and the analytics extracts** all hold the same records. Either bound their retention consistently, or accept — and document — that erasure is eventual, bounded by the backup cycle, which is the standard position regulators accept when it is stated explicitly (Q17).

**5. Prove it.** Auditors ask for evidence that deletion happened. Emit an audit event for each retention action (class, record count, date range, policy id) so disposition is demonstrable rather than assumed.

---

## Q17. How do you securely delete sensitive data?

**"Securely" means the data is unrecoverable — which is a different and much harder property than the row no longer appearing in a query.** The answer differs completely by storage layer, and the honest answer names where true deletion is impossible and what you do instead.

**Why a `DELETE` statement is not deletion:**

| Where the data survives | Why |
|---|---|
| **Database pages** | Rows are marked unused; the bytes stay on the page until overwritten and remain readable in a raw file or forensic dump |
| **Transaction log / WAL** | The old value is in the log until it is truncated |
| **Backups and snapshots** | Every backup taken before the delete still contains it — often for years |
| **Read replicas, DR copies** | Same data, separate lifecycle |
| **Search indexes, caches, data lake, exports** | Copies with independent deletion paths |
| **SSD physical media** | Wear levelling and over-provisioning mean an overwrite may not touch the original cells — **this is why physical overwriting is not a valid strategy on modern storage or in the cloud** |

**The techniques, and when each applies:**

**1. Crypto-shredding — the primary answer for cloud and for backups.** Encrypt the data with a key **scoped to the thing you may need to erase** (per customer, per tenant, per year), then **destroy the key**. The ciphertext remains in every backup, snapshot and replica, and is permanently unreadable. NIST SP 800-88 recognises "cryptographic erase" as a valid sanitisation method, and it is the **only practical way to honour an erasure request against immutable backups**:

```text
customer 914  ->  data key DK-914  (wrapped by a KMS key)
erasure request:  ScheduleKeyDeletion(DK-914)
                  every copy of that customer's ciphertext, everywhere,
                  including seven years of backups, is now unrecoverable
```

The design cost is that you must **decide the key granularity up front**. A single key for the whole database gives you nothing; a key per data subject gives you precise erasure. This is a schema decision made years before the first erasure request.

**2. Overwrite-in-place before delete, for the primary store.** Update the sensitive columns to a fixed value, then delete the row — so at minimum the current page no longer holds the plaintext, even though the log and backups still do:

```sql
UPDATE customers
   SET national_id = 0x00, email = 'redacted@invalid', full_name = 'REDACTED'
 WHERE customer_id = @id;
DELETE FROM customers WHERE customer_id = @id;
```

**3. Anonymisation instead of deletion** — usually the correct answer when referential integrity or regulatory retention prevents removal. Strip or hash the identifying fields and keep the transactional shell, so the ledger still balances and the audit trail still reconciles while the record no longer relates to an identifiable person. **The bar is irreversibility, including by combination with other data you hold** — replacing a name with a stable pseudonym that still joins to a live customer table is pseudonymisation, not anonymisation, and remains in GDPR scope.

**4. Propagate the deletion across the estate.** In a microservices architecture, erasure is a **distributed workflow**, not a statement: publish a `CustomerErasureRequested` event, have every owning service delete or anonymise its copy, collect acknowledgements, and **track completion** — because the regulator's question is "has it been deleted everywhere?", and an unacknowledged consumer is an unmet obligation. This is a saga (Module 14) with a compliance deadline attached.

**5. Media and managed-service reality.** In AWS you never sanitise media yourself: the shared-responsibility model puts decommissioning on AWS, which follows NIST 800-88 for media destruction. Your equivalent controls are **deleting the KMS key**, deleting snapshots and AMIs, and emptying versioned S3 buckets **including delete markers and previous versions** — a `DELETE` on a versioned bucket only adds a marker and leaves every prior version fully retrievable, which is a genuinely common mistake.

**6. Document the residual.** Where backups cannot be selectively edited, the defensible position — and the one supervisory authorities accept — is: data is removed from live systems immediately, backups are encrypted with restricted access, backup copies age out within the stated retention window, and any restore triggers re-application of the erasure log. **State it as a documented control with a bounded window, not as a gap you hope nobody asks about.**

---

## Q18. How do you secure backups?

**Backups are a full copy of production with weaker controls and longer retention — which makes them the highest-value, lowest-friction target in the estate.** Most large data breaches involving "a database" involve a backup: an unencrypted snapshot shared publicly, an S3 bucket of dumps left open, a tape in a car.

**The controls, and each maps to a specific attack:**

| Control | Attack it defeats |
|---|---|
| **Encrypt every backup with a customer-managed KMS key** | Stolen or publicly shared snapshot; a copy landing in a third party's account |
| **Encrypt in transit** to the backup target | Interception of the transfer |
| **Least-privilege, separate IAM roles** for backup vs restore | A compromised app role exfiltrating history |
| **Separate AWS account / subscription for the vault** | **Ransomware and malicious insiders** — the single most important control |
| **Immutability: AWS Backup Vault Lock in compliance mode, or S3 Object Lock** | Deletion by an attacker who has obtained root in the production account |
| **MFA delete on versioned buckets** | Casual or scripted deletion |
| **No public access; block public sharing of snapshots** | The classic "snapshot marked public" breach |
| **Audit every restore and every vault access** | Undetected exfiltration via restore |
| **Restore into an isolated, masked environment** | A restore quietly recreating production data in a low-trust environment |

**The 3-2-1-1-0 rule**, which is the shape modern financial-services backup strategy has converged on: **3** copies, on **2** media types, **1** off-site, **1 immutable or offline**, with **0** verification errors. The added "1 immutable" exists specifically because ransomware now targets backups first — an attacker with domain or account admin who can delete your backups has removed your only genuine recovery path, so **immutability, not merely a second copy, is what makes the backup a control rather than a convenience**.

**Compliance mode is the detail that matters.** AWS Backup Vault Lock and S3 Object Lock both offer *governance* mode (a sufficiently privileged principal can override) and *compliance* mode (**nobody can shorten or remove the retention, including the account root, for the locked period**). Only compliance mode survives a full account compromise. It is also irreversible for the locked period, so the retention window must be chosen deliberately.

**The half of the answer people forget: an untested backup is not a backup.**

- **Test restores on a schedule** — quarterly at minimum, and time them, because the number that matters is not "do we have a backup" but **RTO**: how long from decision to a working system. Untested restores fail on missing KMS grants, an expired key in the DR region, a schema mismatch, or a dependency nobody documented.
- **Verify integrity** — checksums, and a functional smoke test after restore, not just "the job reported success."
- **Confirm the KMS key exists and is usable in the DR region.** An encrypted snapshot copied cross-region without the corresponding multi-Region or replica key is unrecoverable, and this is discovered at exactly the wrong moment.
- **Rehearse the full DR scenario**, including the case where the production account itself is compromised and unavailable — which is why the vault lives in a different account with a different set of credentials.

**And the data-protection points specific to backups:** apply the **retention schedule** to them (Q16) rather than keeping them indefinitely, treat them as in-scope for **classification and erasure** (Q17 — crypto-shredding is what makes selective erasure possible here), and remember that a **restored** copy inherits none of the source environment's access controls unless you re-apply them.

---

## Q19. How do you secure database connections?

**Encrypt them, authenticate both ends, restrict who can reach the endpoint at the network level, and bound the pool.** Each layer defeats a different attack, and the strongest answer walks the path from application to database.

**1. Encrypt in transit — and *verify*, which is the part usually done wrong.**

```text
Server=db.internal;Database=payments;
Encrypt=True;                       -- default in Microsoft.Data.SqlClient 4.0+
TrustServerCertificate=False;       -- MUST be False: True disables validation entirely
HostNameInCertificate=db.internal;
```

`TrustServerCertificate=True` encrypts the traffic but **skips certificate validation**, so any machine that can intercept the connection can present its own certificate and read everything — encryption without authentication is not protection against an active attacker. It appears in countless production connection strings because it makes a certificate error go away. For PostgreSQL/Npgsql the equivalent is `SslMode=VerifyFull` (verifies both the chain and the hostname), not `Require` (encrypts but verifies nothing).

**Enforce it server-side rather than trusting clients:** `rds.force_ssl=1` on RDS PostgreSQL, `require_secure_transport=ON` on MySQL, "Minimum TLS version 1.2" and "Deny public network access" on Azure SQL. A client-side setting is a request; a server-side setting is a control.

**2. Authenticate without a shared password** where possible — IAM database authentication or managed identity (Q9), which also removes the credential-rotation problem. Where a password is unavoidable, it comes from Secrets Manager, never from configuration.

**3. Do not expose the endpoint.** The database should be unreachable from the internet, and from most of the VPC:

- **Private subnets only**, no public IP, no `PubliclyAccessible=true`.
- **Security group referencing the application's security group**, not a CIDR — so the rule stays correct as instances change: `allow tcp/1433 from sg-app`.
- **VPC endpoints / PrivateLink** for managed services so traffic never traverses the internet.
- **No direct developer access to production.** Access goes through a bastion or SSM Session Manager port forwarding, is time-boxed, requires MFA, and is logged. Standing production database credentials on laptops is the vector behind a large share of real incidents.

**4. Pool correctly, because connection pooling has security consequences and not only performance ones.**

- Connections are **reused across requests**, so any per-connection state — `SESSION_CONTEXT` for RLS (Q11), `SET ROLE`, temp tables — **leaks between users unless set on every open**. This is the practical bug that turns RLS into a false sense of safety.
- Pools are **keyed by the exact connection string**, so building strings dynamically per tenant fragments the pool and can exhaust the server's connection limit (Module 11).
- Bound the pool (`Max Pool Size`) and set `Connect Timeout` so exhaustion produces a fast, visible failure instead of a creeping hang.
- Use **RDS Proxy** or **PgBouncer** for Lambda and high-churn workloads: it holds the credential in Secrets Manager, multiplexes connections, and survives failover without the application storing anything.

**5. Least privilege on the principal itself** (Q10) — the connection's identity should be able to do only what that service needs, in only its own schema, with separate read-only credentials for query-side workloads.

**6. Monitor the connection layer.** Alert on failed logins (credential stuffing against the database), on connections from unexpected source IPs or principals, and on unusual query volume from a service account — the signature of exfiltration through a legitimate credential. Database auditing (Q14) is what makes this visible.

---

## Q20. How do you design a secure data architecture?

The synthesis question. Answer it as **layers of defence around a classified data inventory**, not as a list of features — and make the trade-offs explicit, because at this level the interviewer is testing judgement about cost and blast radius, not recall.

**Start from the data, not the technology.** Classify (Q12), inventory every copy, and assign each class an owner, a legal basis, a retention period and a required control level. Every subsequent decision derives from that table. A design that applies the same controls to marketing preferences and to card data is either too expensive or too weak, and usually both.

**Then the layers, each with a distinct threat model:**

| Layer | Controls | Defeats |
|---|---|---|
| **Network** | Private subnets, security groups referencing SGs, PrivateLink/VPC endpoints, no public endpoints, WAF at the edge | Direct network attack, lateral movement |
| **Identity** | IAM roles and managed identities over static credentials, IRSA on EKS, MFA, short-lived tokens, no standing production access | Credential theft, insider misuse |
| **Application** | Parameterised queries, output DTOs, object-level authorization (BOLA), input validation, idempotency | Injection, BOLA/BOPLA, mass assignment |
| **Database** | Least-privilege principals, **RLS** for need-to-know, DDM for casual exposure, auditing | A compromised application credential |
| **Data** | TLS in transit, TDE/KMS at rest, **Always Encrypted or app-side envelope encryption** for the crown jewels, **tokenisation** to shrink scope | Stolen media, malicious DBA, cloud-provider access |
| **Key management** | KMS/HSM, per-tenant or per-subject data keys, rotation, separation of duties on decrypt | Key compromise; enables crypto-shredding |
| **Observability** | Immutable audit log in a separate account, CloudTrail, database auditing, Macie, GuardDuty | Undetected breach; inability to scope an incident |
| **Lifecycle** | Retention schedules, automated expiry, masked lower environments, tested restores, erasure workflow | Over-retention, test-environment leaks, unrecoverable ransomware |

**The four design decisions that actually shape the architecture**, and the ones worth arguing explicitly:

1. **Where does encryption happen?** Storage-level (TDE) is free and transparent but does not defend against anyone who reaches the data through the database. Application-level defends against the database itself but **breaks range queries, sorting, `LIKE` and most indexing** — so it is applied to specific columns after a deliberate query-pattern analysis, not to everything. Say which columns and why.
2. **What is the key granularity?** One key per environment is simple and gives you no selective erasure. One key per data subject gives precise crypto-shredding and per-subject revocation, at the cost of key-management volume and a KMS call pattern you must cache. **This choice must be made before the first row is written**, which is why it belongs in the design review rather than in a later hardening sprint.
3. **What can you avoid holding?** Tokenise PANs and let a PCI-compliant provider hold them; federate authentication so you hold no passwords; store `over_18` rather than date of birth. **Every field removed deletes an entire column of controls, audit obligations and breach exposure.** This is the highest-leverage decision in the whole design and it is architectural, not technical.
4. **Where is the blast radius boundary?** Separate accounts for production, audit and backup; separate keys per tenant; separate credentials per service. Assume any single component is compromised and ask what the attacker reaches next — that question, applied honestly, produces a better architecture than any checklist.

**The properties the finished design must be able to demonstrate**, because in a regulated firm the control that cannot be evidenced does not count:

- **Who accessed what, when** — answerable by query, for any record, years later.
- **Every copy of restricted data is known, encrypted, access-controlled and retention-bounded.**
- **A single compromised component does not yield the whole dataset** — the application credential does not defeat RLS; the DBA does not defeat Always Encrypted; the production account does not defeat the backup vault lock.
- **Erasure is executable and provable**, across services and backups.
- **The restore path is tested**, with the keys available in the DR region.
- **Lower environments contain no real customer data.**

**Close on the honest trade-off**, since this is what a Principal-level answer sounds like: each layer costs latency, complexity and operational burden. Always Encrypted removes query capability. Per-subject keys add a KMS call to every read. Immutable backups cost storage and remove your ability to correct a mistake. **You buy these controls for the data classes that justify them, and you say so out loud in the design document** — an architecture that applies maximum protection uniformly will either be rejected on cost or quietly bypassed in delivery, and a control that is bypassed protects nothing.

---

## References — official documentation and standards

| Topic | Source |
|---|---|
| **NIST SP 800-57 — Key Management (cryptoperiods, rotation)** | https://csrc.nist.gov/pubs/sp/800/57/pt1/r5/final |
| NIST SP 800-63B — Digital Identity (password storage, memorized secrets) | https://pages.nist.gov/800-63-3/sp800-63b.html |
| NIST SP 800-88 — Guidelines for Media Sanitization (cryptographic erase) | https://csrc.nist.gov/pubs/sp/800/88/r1/final |
| NIST FIPS 197 — AES | https://csrc.nist.gov/pubs/fips/197/final |
| NIST FIPS 203/204 — ML-KEM / ML-DSA (post-quantum) | https://csrc.nist.gov/pubs/fips/203/final |
| OWASP — Password Storage Cheat Sheet | https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html |
| OWASP — Cryptographic Storage Cheat Sheet | https://cheatsheetseries.owasp.org/cheatsheets/Cryptographic_Storage_Cheat_Sheet.html |
| OWASP — Secrets Management Cheat Sheet | https://cheatsheetseries.owasp.org/cheatsheets/Secrets_Management_Cheat_Sheet.html |
| OWASP — Logging Cheat Sheet | https://cheatsheetseries.owasp.org/cheatsheets/Logging_Cheat_Sheet.html |
| OWASP — SQL Injection Prevention Cheat Sheet | https://cheatsheetseries.owasp.org/cheatsheets/SQL_Injection_Prevention_Cheat_Sheet.html |
| Microsoft Learn — Transparent Data Encryption (TDE) | https://learn.microsoft.com/en-us/sql/relational-databases/security/encryption/transparent-data-encryption |
| Microsoft Learn — Always Encrypted | https://learn.microsoft.com/en-us/sql/relational-databases/security/encryption/always-encrypted-database-engine |
| Microsoft Learn — Dynamic Data Masking (and its limitations) | https://learn.microsoft.com/en-us/sql/relational-databases/security/dynamic-data-masking |
| Microsoft Learn — Row-Level Security | https://learn.microsoft.com/en-us/sql/relational-databases/security/row-level-security |
| Microsoft Learn — SQL Server Audit | https://learn.microsoft.com/en-us/sql/relational-databases/security/auditing/sql-server-audit-database-engine |
| Microsoft Learn — SQL Server Ledger (tamper-evidence) | https://learn.microsoft.com/en-us/sql/relational-databases/security/ledger/ledger-overview |
| Microsoft Learn — SQL Data Discovery & Classification | https://learn.microsoft.com/en-us/sql/relational-databases/security/sql-data-discovery-and-classification |
| Microsoft Learn — ASP.NET Core Data Protection (key management, rotation) | https://learn.microsoft.com/en-us/aspnet/core/security/data-protection/introduction |
| Microsoft Learn — ASP.NET Core Identity password hashing | https://learn.microsoft.com/en-us/aspnet/core/security/authentication/identity |
| Microsoft Learn — Safe storage of app secrets in development | https://learn.microsoft.com/en-us/aspnet/core/security/app-secrets |
| Microsoft Learn — Data redaction (`Microsoft.Extensions.Compliance.Redaction`) | https://learn.microsoft.com/en-us/dotnet/core/extensions/data-redaction |
| Microsoft Learn — SqlClient connection encryption (`Encrypt`, `TrustServerCertificate`) | https://learn.microsoft.com/en-us/sql/connect/ado-net/connection-string-syntax |
| PostgreSQL — Row Security Policies | https://www.postgresql.org/docs/current/ddl-rowsecurity.html |
| PostgreSQL — SSL support / `sslmode` | https://www.postgresql.org/docs/current/libpq-ssl.html |
| **AWS KMS Developer Guide (envelope encryption, rotation, key policies)** | https://docs.aws.amazon.com/kms/latest/developerguide/overview.html |
| AWS KMS — automatic key rotation | https://docs.aws.amazon.com/kms/latest/developerguide/rotate-keys.html |
| AWS Secrets Manager — rotation strategies (single vs alternating user) | https://docs.aws.amazon.com/secretsmanager/latest/userguide/rotating-secrets.html |
| AWS Systems Manager Parameter Store — SecureString | https://docs.aws.amazon.com/systems-manager/latest/userguide/systems-manager-parameter-store.html |
| AWS RDS — encryption at rest | https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/Overview.Encryption.html |
| AWS RDS — IAM database authentication | https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/UsingWithRDS.IAMDBAuth.html |
| AWS RDS Proxy | https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/rds-proxy.html |
| AWS Backup — Vault Lock (compliance mode) | https://docs.aws.amazon.com/aws-backup/latest/devguide/vault-lock.html |
| AWS S3 — Object Lock (WORM) | https://docs.aws.amazon.com/AmazonS3/latest/userguide/object-lock.html |
| AWS S3 — lifecycle configuration | https://docs.aws.amazon.com/AmazonS3/latest/userguide/object-lifecycle-mgmt.html |
| AWS Macie — sensitive data discovery | https://docs.aws.amazon.com/macie/latest/user/what-is-macie.html |
| AWS CloudTrail — log file integrity validation | https://docs.aws.amazon.com/awscloudtrail/latest/userguide/cloudtrail-log-file-validation-intro.html |
| AWS DynamoDB — Time to Live (TTL) | https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/TTL.html |
| AWS Well-Architected — Security pillar (data protection) | https://docs.aws.amazon.com/wellarchitected/latest/security-pillar/data-protection.html |
| PCI DSS v4.0 (Requirement 3 — protect stored account data) | https://www.pcisecuritystandards.org/document_library/ |
| GDPR — Articles 5, 17, 25, 32 (minimisation, erasure, by design, security) | https://gdpr-info.eu/ |

---

**Previous:** [16 — API Security / OWASP](./16-API-Security-OWASP.md) | **Next:** [18 — System Design](./18-System-Design.md)
