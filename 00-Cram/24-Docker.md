# Docker — Cram Sheet

> Tier 2 · Source: `24-Docker/` (4 modules, 2,373 lines) · Read: 10 min

---

## 1. Images & Layers

- An image is an **ordered stack of read-only layers**, content-addressed by **digest** (`sha256:...`). A tag is a mutable pointer; **a digest is the only immutable reference** — pin digests in production.
- **OverlayFS:** `lowerdir` (image layers) + `upperdir` (container writable layer) → `merged` view. Writing to an existing file triggers **whole-file copy-on-write** — which is why writing to a large file inside a container is surprisingly expensive, and why you use volumes for data.
- **Layer caching:** an instruction's cache is invalidated by its own change **and by any earlier layer changing**. Therefore: **order from least- to most-frequently-changing.**
  ```dockerfile
  COPY *.csproj ./          # narrow COPY first — cache key is only the project files
  RUN dotnet restore        # this layer survives every source-only change
  COPY . ./                 # broad COPY last
  RUN dotnet publish -c Release -o /app
  ```
- **Deleting a file in a later layer does not shrink the image** — the bytes remain in the earlier layer, just hidden by a whiteout file. **This is why a secret added then `rm`-ed is still recoverable from the image.**
- **Registries** store manifests + deduplicated blobs; identical layers are pulled once.
- **BuildKit** (default now) — parallel DAG execution, better caching, and **`--mount=type=secret`**, which is the *structural* fix for build secrets: the secret is mounted only for that instruction and **never written to any layer**.

---

## 2. Dockerfile Optimisation

- **Multi-stage builds are a structurally stronger guarantee than any single-stage mitigation** — the build toolchain, source, and any build-time secret simply do not exist in the final image, rather than being cleaned up.
  ```dockerfile
  FROM mcr.microsoft.com/dotnet/sdk:9.0 AS build
  # ... restore, build, publish ...
  FROM mcr.microsoft.com/dotnet/aspnet:9.0 AS final
  COPY --from=build /app .
  USER $APP_UID
  ENTRYPOINT ["dotnet","Api.dll"]
  ```
- **Named stages + `--target`** let one Dockerfile serve build, test and production.
- **Base images:** `scratch` (static binaries only) → **distroless** (no shell, no package manager — smallest attack surface, hardest to debug) → **alpine** (musl libc — **real .NET compatibility caveats**: globalization/ICU, some native deps) → slim → full.
- **`.dockerignore` is a separate concern from layer optimisation** — it controls the **build context** sent to the daemon. Without it you ship `bin/`, `obj/`, `.git` and `node_modules` to the daemon on every build (slow) and risk `COPY .` baking in secrets.
- **`ARG` vs `ENV`:** `ARG` is build-time only and **does not appear in the running container — but it IS recorded in the image history**, so **`ARG` is not a safe way to pass a secret.** `ENV` persists into the container. Use BuildKit secret mounts.

---

## 3. Runtime Internals

- **A container is a process, not a VM** — it shares the host kernel. That shared-kernel boundary is exactly why defence in depth matters.
- **Namespaces = isolation** (what a process can *see*), six of them: **PID · NET · MNT · UTS · IPC · USER**.
- **cgroups = limiting** (what a process can *use*): CPU, memory, I/O, PIDs. **A genuinely different function from namespaces** — a common interview distinction.
- **Capabilities** split all-or-nothing root into ~40 units (`NET_BIND_SERVICE`, `SYS_ADMIN`, …). Best practice: `--cap-drop=ALL` then add back only what's needed.
- **seccomp** restricts which **syscalls** a process may make at all. Docker ships a default profile blocking ~44 dangerous syscalls.
- **Rootless containers / user namespaces** remap container root to an unprivileged host UID — **changes the blast radius of a successful escape** from host root to a nobody user.
- **`--privileged` disables essentially all of this.** Never in production.

---

## 4. Compose, Networking, Volumes

- **`depends_on` waits for *started*, not *ready*** — the classic gotcha. Use `condition: service_healthy` with a `healthcheck`, or make the app retry its dependencies (which you need anyway in production).
- **Compose networking** — services resolve each other by **service name** on a user-defined bridge network. This is the single-host ancestor of Kubernetes Service DNS.
- **Named volumes** are the single-host ancestor of PersistentVolumes; bind mounts are for development. **Anonymous volumes accumulate silently.**
- **Compose override files** (`docker-compose.override.yml`, `-f` layering) handle per-environment config — the orchestration-level analogue of multi-stage targets.
- **Resource limits + restart policies** in Compose are the cgroup settings expressed in YAML.
- **When Compose is enough:** a single host, dev/CI, a small internal tool. **When you need Kubernetes:** multi-node scheduling, self-healing across hosts, rolling deploys with health gating, autoscaling, and declarative multi-team operations.

---

## Production checklist

- Multi-stage build · non-root `USER` · pinned base image **digest** · `.dockerignore` · no secrets in `ARG`/layers (BuildKit mounts) · `HEALTHCHECK` · read-only root filesystem · `--cap-drop=ALL` · resource limits · image scanning in CI · **one process per container** · handle `SIGTERM` for graceful shutdown.

---

## Top traps

1. `rm` a secret in a later layer and believe it's gone.
2. `ARG` used for a secret (it's in the image history).
3. `COPY . .` before `restore`/`install` → cache destroyed on every source change.
4. No `.dockerignore`.
5. Running as root.
6. `latest` tag in production.
7. `depends_on` assumed to mean "ready".
8. Alpine chosen for .NET without checking ICU/globalization.
9. `--privileged` as a fix for a permissions error.
10. Confusing namespaces (isolation) with cgroups (limits).

---

## 30-second answers

- **"How do you reduce image size and build time?"** → Two different problems. Size: multi-stage build so the SDK and source never reach the final image, plus a minimal runtime base — distroless if I don't need a shell. Build time: order layers least- to most-frequently-changing, so a narrow `COPY *.csproj` + `restore` comes before the broad `COPY .`; then a source change doesn't invalidate the restore layer. And `.dockerignore`, because otherwise the whole context is uploaded every build.
- **"Container vs VM?"** → A container is a process with a restricted view — namespaces isolate what it sees, cgroups limit what it uses — sharing the host kernel. A VM has its own kernel behind a hypervisor. So containers start in milliseconds and cost almost nothing, but the isolation boundary is weaker: a kernel exploit crosses it. That's why you layer capabilities, seccomp and rootless on top rather than treating the container as a security boundary by itself.
- **"How do you handle build secrets?"** → BuildKit `--mount=type=secret`, so the secret is available only during that instruction and never written to a layer. `ARG` is the wrong answer — it doesn't appear in the running container, which fools people, but it *is* recorded in the image history and recoverable. Same for adding a file and deleting it later: the bytes stay in the earlier layer behind a whiteout.

---

**Go deeper:** `24-Docker/01`–`04` · **Related:** [[23-Kubernetes]], [[25-DevOps-CICD]], [[28-Security]]
