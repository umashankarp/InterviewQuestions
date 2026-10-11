(function (r) {
registerTopic('24-docker', {
related: ['23-kubernetes', '26-cicd', '25-devops'],
questions: [
{ id: 'q1', level: 'Basic', tags: ['containers-vs-vms', 'fundamentals', 'isolation'],
  q: r`What is a container, really, and how does it differ from a virtual machine? Explain the isolation boundary, startup and density trade-offs, and when a VM is still the right choice.`,
  a: r`**A container is an ordinary Linux process** (or process tree) started with:
- **Namespaces** that give it its own view of the system: PID (its own process tree, it is PID 1 inside), network (own interfaces and IP), mount (own filesystem view), UTS (hostname), IPC, user (UID mapping) and cgroup namespaces.
- **cgroups** that limit and account its resources (CPU, memory, I/O, PIDs).
- A **root filesystem** assembled from image layers (OverlayFS).
- Security filters: dropped **capabilities**, **seccomp** syscall filtering, AppArmor/SELinux profiles.

There is **no guest kernel**: all containers on a host share the host's kernel.

**VM**: a hypervisor emulates hardware; each VM runs its own full kernel and OS.

| | Container | VM |
|---|---|---|
| Isolation boundary | kernel features (namespaces, cgroups, seccomp) — shared kernel | hardware virtualisation — separate kernels |
| Startup | milliseconds to seconds (process start) | tens of seconds to minutes (OS boot) |
| Overhead / density | very low; hundreds per host | GBs per VM; tens per host |
| Image size | MBs (app + libraries) | GBs (full OS) |
| OS | same kernel family as host (Linux containers need a Linux kernel; Docker Desktop runs a small Linux VM on Mac/Windows) | any OS |

**Why it matters for security**: a kernel vulnerability or a misconfigured container (privileged, host mounts) can lead to **escape** to the host and every other container on it. Containers are a strong packaging and resource boundary, a weaker security boundary than VMs.

**When a VM (or VM-backed sandbox) is still right**
- Untrusted or multi-tenant code from different customers → VM isolation or sandboxed runtimes (gVisor, Kata Containers, Firecracker microVMs as in AWS Lambda/Fargate).
- Different kernels or OS (Windows workloads on Linux hosts, kernel modules, custom kernel tuning).
- Regulatory requirements for hardware-level isolation.

**Interview framing**: containers package **the application and its dependencies**, not an operating system; reproducibility and density are the wins, the shared kernel is the trade-off.`,
  code: r`~~~bash
# A container is just a process on the host: same kernel, different namespaces
docker run -d --name api -p 8080:8080 mcr.microsoft.com/dotnet/samples:aspnetapp
docker inspect -f '{{.State.Pid}}' api          # host PID of the container's PID 1
sudo ls -l /proc/$(docker inspect -f '{{.State.Pid}}' api)/ns   # its namespaces
uname -r && docker exec api uname -r             # identical kernel version
~~~`,
  dia: r`flowchart TB
  subgraph VMHOST[VM host]
    HV[Hypervisor]
    HV --> VM1[VM: guest kernel + OS + app]
    HV --> VM2[VM: guest kernel + OS + app]
  end
  subgraph CHOST[Container host]
    K[Shared Linux kernel: namespaces, cgroups, seccomp]
    K --> C1[Container: app + libs]
    K --> C2[Container: app + libs]
    K --> C3[Container: app + libs]
  end`,
  pts: [r`A container is a process with namespaces, cgroups, a layered rootfs and security filters.`, r`Containers share the host kernel; VMs run separate kernels.`, r`Containers win on startup, density and image size.`, r`Shared kernel makes containers a weaker security boundary.`, r`Use VMs or sandboxed runtimes for untrusted multi-tenant code or different kernels.`],
  ex: r`A SaaS provider running customer-supplied scripts moved them from plain containers to Firecracker microVMs after a kernel CVE made container escape a realistic risk.`,
  fu: [r`How does Docker Desktop run Linux containers on macOS?`, r`What do gVisor and Kata Containers change about the isolation model?`],
  pit: [r`Calling containers lightweight VMs.`, r`Assuming container isolation is equivalent to VM isolation.`, r`Forgetting the kernel is shared.`] },

{ id: 'q2', level: 'Basic', tags: ['architecture', 'containerd', 'runc', 'oci'],
  q: r`Explain Docker's architecture: the CLI, dockerd, containerd, the shim and runc, plus the OCI image and runtime specifications. How do Docker, containerd, CRI-O and Podman relate, and what did Kubernetes' dockershim removal actually change?`,
  a: r`**The stack when you run {{docker run}}**
1. **docker CLI** sends a REST request to the **Docker daemon (dockerd)** over a Unix socket ({{/var/run/docker.sock}}) or TCP.
2. **dockerd** handles images (build via BuildKit, pull, push), networks, volumes, and delegates container lifecycle to **containerd**.
3. **containerd** (a CNCF project) manages images/snapshots and container lifecycle; for each container it starts a **containerd-shim**.
4. The shim invokes **runc**, which creates namespaces and cgroups, sets up the rootfs and execs the process — then runc exits; the shim stays as the parent so containers survive daemon restarts and stdout/exit codes are collected.

**OCI specifications** (Open Container Initiative)
- **Image spec**: manifest, config, layers (tarballs), content-addressed by SHA-256 digest; **image index** for multi-architecture.
- **Runtime spec**: a filesystem bundle + {{config.json}} that a runtime (runc, crun, gVisor's runsc, Kata) executes.
- **Distribution spec**: the registry HTTP API.
Because of OCI, an image built by Docker runs on containerd, CRI-O, Podman, or any cloud service.

**Relatives**
- **containerd**: the runtime under Docker and the default runtime for most Kubernetes clusters (via its CRI plugin).
- **CRI-O**: a Kubernetes-only runtime (OpenShift).
- **Podman**: daemonless, rootless-first CLI compatible with Docker commands; uses runc/crun directly; pods concept; popular where the root daemon is a concern.
- **BuildKit/buildx**: the build engine (default in Docker since 23.0).

**dockershim removal (Kubernetes 1.24)**: the kubelet stopped talking to dockerd through the dockershim adapter and talks to CRI runtimes (containerd, CRI-O) directly. **Images built with Docker still run unchanged** (they are OCI images). What changed: nodes no longer have dockerd, so tools that relied on mounting {{docker.sock}} on nodes (Docker-in-Docker builds, some monitoring agents) broke; {{docker ps}} on nodes is replaced by {{crictl}}.`,
  code: r`~~~bash
docker info --format '{{.ServerVersion}} {{.DefaultRuntime}} cgroup={{.CgroupVersion}}'
ps -ef --forest | grep -E 'dockerd|containerd|shim' | grep -v grep     # daemon, containerd, one shim per container
# On a Kubernetes node (containerd, no dockerd): CRI tooling instead of docker
sudo crictl ps
sudo crictl inspecti registry.example/payments-api@sha256:9c1e...
~~~`,
  dia: r`flowchart LR
  CLI[docker CLI] -->|REST over docker.sock| D[dockerd: build, images, networks, volumes]
  D --> CT[containerd: images, snapshots, lifecycle]
  CT --> SH[containerd-shim per container]
  SH --> RC[runc: namespaces, cgroups, exec]
  RC --> P[Container process]
  K[kubelet] -->|CRI| CT
  POD[Podman] --> RC`,
  pts: [r`CLI → dockerd → containerd → shim → runc → process.`, r`The shim keeps containers alive across daemon restarts.`, r`OCI image, runtime and distribution specs make images portable.`, r`containerd and CRI-O are Kubernetes runtimes; Podman is daemonless and rootless-first.`, r`dockershim removal did not break Docker-built images; it broke docker.sock dependencies on nodes.`],
  ex: r`After a Kubernetes upgrade removed dockershim, a team's CI builds that mounted the node's docker.sock failed; they moved image builds to BuildKit in rootless mode in CI instead.`,
  fu: [r`Why does a container keep running when dockerd restarts?`, r`What does Podman's daemonless design change for security?`],
  pit: [r`Believing Kubernetes stopped supporting Docker images.`, r`Mounting docker.sock into application containers.`, r`Confusing containerd with dockerd.`] },

{ id: 'q3', level: 'Basic', tags: ['images', 'layers', 'overlayfs', 'digests'],
  q: r`How are images built from layers? Explain OverlayFS and copy-on-write, manifests and digests versus tags, multi-architecture image indexes, and why layer order matters.`,
  a: r`**Layers**: each filesystem-changing Dockerfile instruction ({{RUN}}, {{COPY}}, {{ADD}}) produces a layer — a tarball of file additions, modifications and deletions (whiteout files). Layers are **immutable** and **content-addressed** (SHA-256), shared between images and cached on hosts and registries.

**OverlayFS (overlay2 driver)**: the read-only image layers are stacked as **lowerdirs**; each container gets a thin writable **upperdir**; the **merged** view is what the process sees.
- **Copy-on-write**: modifying a file from a lower layer copies the whole file into the upper layer first — expensive for large files and a reason not to write heavily inside the container filesystem (use volumes).
- Deleting a file in a later layer does **not** shrink the image: the bytes remain in the earlier layer (common mistake: downloading an archive in one RUN and deleting it in the next).

**Manifest, config, digest**
- The **manifest** lists the config blob and layer digests; the **config** holds metadata (env, entrypoint, user, history).
- The **image digest** (sha256 of the manifest) identifies exactly one image. A **tag** ({{:1.4.2}}, {{:latest}}) is a mutable pointer that can be moved to a different digest at any time.
- Production deployments should reference **digests** ({{image@sha256:...}}), or immutable tags enforced by the registry.

**Multi-architecture**: an **image index** (manifest list) maps platforms ({{linux/amd64}}, {{linux/arm64}}) to platform-specific manifests; the client pulls the right one. Matters for Graviton/Ampere servers and Apple Silicon laptops.

**Why order matters**: the build cache is invalidated from the first changed layer onwards. Put rarely changing steps first (base image, OS packages, dependency restore) and frequently changing steps last (copy source, build). Combine related commands into one RUN to avoid leaving junk in intermediate layers.`,
  code: r`~~~bash
docker image inspect mcr.microsoft.com/dotnet/aspnet:8.0 --format '{{json .RootFS.Layers}}' | jq length
docker history --no-trunc registry.example/payments-api:1.4.2       # one row per layer, with the creating instruction
docker buildx imagetools inspect mcr.microsoft.com/dotnet/aspnet:8.0  # image index: amd64, arm64, arm/v7 manifests
docker pull registry.example/payments-api@sha256:9c1e...               # pin the exact image, not a movable tag
~~~
~~~dockerfile
# Anti-pattern: the archive stays in layer 1 even though layer 2 deletes it
RUN curl -o /tmp/tool.tgz https://example/tool.tgz
RUN tar -xzf /tmp/tool.tgz -C /opt && rm /tmp/tool.tgz
# Fix: download, extract and delete in the same layer
RUN curl -fsSL https://example/tool.tgz | tar -xz -C /opt
~~~`,
  dia: r`flowchart TB
  UP[Container writable layer - upperdir] --> M[Merged view seen by the process]
  L3[Layer 3: app binaries] --> M
  L2[Layer 2: runtime] --> M
  L1[Layer 1: base OS files] --> M
  IDX[Image index] --> MA[manifest linux/amd64]
  IDX --> MB[manifest linux/arm64]
  MA --> L1`,
  pts: [r`Layers are immutable, content-addressed diffs shared across images.`, r`OverlayFS stacks read-only layers under a per-container writable layer; copy-on-write.`, r`Deleting in a later layer never shrinks the image.`, r`Digests identify images exactly; tags are mutable pointers.`, r`Order Dockerfile steps from least to most frequently changing.`],
  ex: r`A team's image was 1.9 GB because the SDK tarball was downloaded in one layer and deleted in the next; a multi-stage build cut it to 110 MB.`,
  fu: [r`How does a registry avoid storing the same layer twice?`, r`What happens when you pull a multi-arch image on an ARM laptop?`],
  pit: [r`Deploying by mutable tags.`, r`Deleting files in later layers to "save space".`, r`Copying source before restoring dependencies.`] },

{ id: 'q4', level: 'Basic', tags: ['dockerfile', 'entrypoint', 'cmd', 'exec-form'],
  q: r`Walk through the core Dockerfile instructions. What is the difference between ENTRYPOINT and CMD, shell form and exec form, and why does exec form matter for signals and graceful shutdown?`,
  a: r`**Core instructions**
- {{FROM}}: base image (pin a version, ideally a digest); multiple FROMs = multi-stage.
- {{WORKDIR}}: sets the working directory (creates it).
- {{COPY}} (prefer over {{ADD}}, which also extracts archives and fetches URLs — surprising behaviour).
- {{RUN}}: executes at **build** time and creates a layer.
- {{ENV}}: environment variables baked into the image (never secrets — they are visible in image history).
- {{ARG}}: build-time variables (also visible in history if used carelessly).
- {{EXPOSE}}: documentation only; does not publish ports.
- {{USER}}: run as non-root.
- {{HEALTHCHECK}}, {{LABEL}} (OCI annotations such as source, revision).
- {{ENTRYPOINT}} and {{CMD}}: what runs at **container start**.

**ENTRYPOINT vs CMD**
- **ENTRYPOINT** is the executable; **CMD** provides default arguments (or the default command if no ENTRYPOINT).
- {{docker run image args}} replaces CMD, not ENTRYPOINT ({{--entrypoint}} overrides it).
- Typical: {{ENTRYPOINT ["dotnet", "Payments.Api.dll"]}} and optional CMD for default flags.

**Exec form vs shell form**
- Exec form: {{["dotnet", "app.dll"]}} — the process runs **directly as PID 1** and receives signals.
- Shell form: {{dotnet app.dll}} — runs as {{/bin/sh -c "dotnet app.dll"}}; the **shell is PID 1** and typically does **not forward SIGTERM** to the child. {{docker stop}} sends SIGTERM, waits (default 10 s), then SIGKILL — the app never gets to shut down gracefully, in-flight requests and messages are lost. Shell form also fails in distroless/chiseled images that have no shell.
- If you need a wrapper script, end it with {{exec "$@"}} so the app replaces the shell.

**PID 1 responsibilities**: signal handling (PID 1 ignores signals without handlers — .NET installs handlers, so exec form works) and reaping zombie child processes (use {{--init}} / tini when the app spawns children).`,
  code: r`~~~dockerfile
FROM mcr.microsoft.com/dotnet/aspnet:8.0-noble-chiseled
WORKDIR /app
COPY --chown=$APP_UID:$APP_UID ./publish/ .
USER $APP_UID
ENV ASPNETCORE_HTTP_PORTS=8080 DOTNET_EnableDiagnostics=0
EXPOSE 8080
LABEL org.opencontainers.image.source="https://git.example/payments-api" \
      org.opencontainers.image.revision="9c1e2f7"
ENTRYPOINT ["dotnet", "Payments.Api.dll"]      # exec form: dotnet is PID 1 and receives SIGTERM
~~~
~~~bash
#!/bin/sh
# entrypoint.sh (only if a wrapper is truly needed, in an image that has a shell)
set -e
export Build__Revision="$(cat /app/REVISION)"
exec "$@"                                       # replace the shell so the app becomes PID 1
~~~`,
  dia: r`flowchart LR
  STOP[docker stop: SIGTERM, 10 s, then SIGKILL] --> EF{Exec form?}
  EF -->|yes| APP[dotnet is PID 1: ApplicationStopping, graceful drain]
  EF -->|no, shell form| SH[sh is PID 1: signal not forwarded]
  SH --> KILL[SIGKILL after timeout: in-flight work lost]`,
  pts: [r`RUN at build time, ENTRYPOINT/CMD at start; EXPOSE is documentation.`, r`ENTRYPOINT is the executable; CMD supplies default args.`, r`Exec form makes the app PID 1 so it receives SIGTERM.`, r`Shell form loses signals and fails in shell-less images.`, r`Wrapper scripts must exec the app; never put secrets in ENV or ARG.`],
  ex: r`A payments worker used shell-form CMD; every deploy killed in-flight messages after 10 seconds. Switching to exec form let the .NET host drain and commit offsets.`,
  fu: [r`When do you need --init or tini?`, r`How do you override the entrypoint for debugging?`],
  pit: [r`Shell-form ENTRYPOINT for long-running apps.`, r`Secrets in ENV or ARG.`, r`Using ADD where COPY is intended.`] },

{ id: 'q5', level: 'Basic', tags: ['volumes', 'bind-mounts', 'tmpfs', 'storage'],
  q: r`Volumes, bind mounts and tmpfs: how do they differ, when should you use each, and why should applications not write data into the container's own filesystem?`,
  a: r`**Container filesystem**: the writable layer is ephemeral — deleted with the container, slower due to copy-on-write, and tied to one host. Writing logs, uploads or databases there means losing data on redeploy and bloating storage.

**Options**
| Type | What | Use for | Caveats |
|---|---|---|---|
| **Named volume** | Docker-managed directory (or driver-backed storage), lifecycle independent of containers | database data in dev, persistent app data on a single host | backup is your job; not shared across hosts unless the driver supports it |
| **Bind mount** | a specific host path mounted into the container | local development (source code), host config files | couples to host layout; permissions/UID mismatches; security risk if mounting sensitive host paths ({{/}}, {{/var/run/docker.sock}}) |
| **tmpfs** | in-memory filesystem | scratch space, secrets that must never hit disk, read-only rootfs with writable {{/tmp}} | lost on stop; counts against memory |

**Patterns**
- Read-only root filesystem ({{--read-only}}) + tmpfs for {{/tmp}} → immutable containers, fewer tampering paths.
- Mount config read-only ({{:ro}}).
- Databases in containers for **development and tests** (volumes or ephemeral), managed databases in production.
- Logs go to **stdout/stderr**, not files.

**Permissions**: the container's process UID must be able to write the mounted path. .NET images run as UID 1654 ({{app}}); named volumes are initialised from the image's directory ownership on first use, while bind mounts keep the host's ownership — a frequent "permission denied" source. Fix with {{--chown}} in the Dockerfile, matching UIDs, or init steps.

**Docker Desktop (Mac/Windows)**: bind mounts cross the VM boundary and are much slower for many small files (node_modules, NuGet caches, bin/obj); use named volumes for caches, synchronized file shares, or develop inside the Linux filesystem (WSL 2).

**Orchestrated equivalents**: Kubernetes {{emptyDir}} (tmp/shared scratch), PersistentVolumeClaims (durable), ConfigMap/Secret volumes (config).`,
  code: r`~~~bash
# Named volume for local SQL Server data; survives container recreation
docker volume create mssql-data
docker run -d --name sql -e ACCEPT_EULA=Y -e MSSQL_SA_PASSWORD="$SA_PASSWORD" \
  -v mssql-data:/var/opt/mssql -p 1433:1433 mcr.microsoft.com/mssql/server:2022-latest

# Immutable app container: read-only rootfs, tmpfs scratch, read-only config bind mount
docker run -d --name api --read-only --tmpfs /tmp:rw,size=64m \
  -v "$PWD/config/appsettings.Production.json:/app/appsettings.Production.json:ro" \
  -p 8080:8080 registry.example/payments-api@sha256:9c1e...
~~~`,
  dia: r`flowchart LR
  C[Container process] --> RW[Writable layer - ephemeral, avoid]
  C -->|/var/opt/mssql| V[(Named volume - Docker managed)]
  C -->|/app/config ro| B[Bind mount - host path]
  C -->|/tmp| T[tmpfs - memory]
  C -->|stdout/stderr| LOG[Logging driver]`,
  pts: [r`The container writable layer is ephemeral and slow: do not store data there.`, r`Named volumes for persistent data, bind mounts for dev and host config, tmpfs for scratch and secrets.`, r`Read-only rootfs plus tmpfs makes containers immutable.`, r`Watch UID permissions on mounts (.NET runs as UID 1654).`, r`Bind mounts are slow on Docker Desktop; use volumes for caches.`],
  ex: r`A reporting container wrote generated PDFs to its own filesystem; a redeploy deleted a day's statements. Writing to object storage (and tmpfs for scratch) fixed it.`,
  fu: [r`How do you back up a named volume?`, r`Why might a bind-mounted directory be read-only to the app even without :ro?`],
  pit: [r`Logs and uploads written inside the container.`, r`Mounting docker.sock or / into containers.`, r`Ignoring UID mismatches on bind mounts.`] },

{ id: 'q6', level: 'Basic', tags: ['networking', 'bridge', 'port-publishing', 'dns'],
  q: r`Explain Docker networking: bridge, host and none drivers, user-defined networks and service-name DNS, port publishing, and how containers reach each other versus the outside world.`,
  a: r`**Drivers**
- **bridge** (default): containers get a private IP on a Linux bridge ({{docker0}} for the default network); outbound traffic is NAT-ed (masqueraded) through the host.
- **user-defined bridge** ({{docker network create}}): the right default for multi-container apps — automatic **DNS by container/service name** via Docker's embedded DNS server ({{127.0.0.11}}), better isolation between networks, attach/detach at runtime. The default {{bridge}} network has no name-based DNS.
- **host**: the container shares the host network namespace — no isolation, no port mapping, best performance; Linux only in its classic form.
- **none**: no networking (batch jobs that must not talk to anything).
- **overlay** (Swarm), **macvlan/ipvlan** (container appears directly on the physical network).

**Port publishing**: {{-p 8080:8080}} maps a host port to a container port using iptables DNAT rules (plus docker-proxy for some cases). {{EXPOSE}} does not publish. Bind to a specific interface ({{-p 127.0.0.1:5432:5432}}) for local-only services — the default binds to **all interfaces**.

**Container-to-container**: on the same user-defined network use the service name and the **container port** ({{http://ledger:8080}}), not localhost and not the published host port. **localhost inside a container means the container itself.**

**Container-to-host**: {{host.docker.internal}} on Docker Desktop (and with {{--add-host=host.docker.internal:host-gateway}} on Linux).

**Security note**: published ports on Linux are inserted into iptables ahead of host firewalls like UFW, so a published database port can be reachable from the network even when UFW "denies" it — publish only what must be public and bind to 127.0.0.1 otherwise.

**In orchestrators** the model changes: Kubernetes gives every pod a routable IP and uses Services for discovery; Compose creates a user-defined network per project automatically.`,
  code: r`~~~bash
docker network create payments-net
docker run -d --name ledger   --network payments-net registry.example/ledger:2.1.0
docker run -d --name payments --network payments-net -p 127.0.0.1:8080:8080 \
  -e Ledger__BaseUrl=http://ledger:8080 registry.example/payments-api:1.4.2   # service-name DNS, container port
docker exec payments getent hosts ledger      # resolved by Docker's embedded DNS (127.0.0.11)
docker network inspect payments-net --format '{{range .Containers}}{{.Name}} {{.IPv4Address}}{{"\n"}}{{end}}'
~~~`,
  dia: r`flowchart LR
  CLIENT[Browser on host :8080] -->|DNAT iptables| PAY[payments container 172.20.0.3:8080]
  subgraph NET[User-defined bridge payments-net - embedded DNS 127.0.0.11]
    PAY -->|http://ledger:8080| LED[ledger container 172.20.0.2:8080]
  end
  PAY -->|masquerade NAT| INET[Internet / PSP]`,
  pts: [r`Use user-defined bridge networks for name-based DNS between containers.`, r`Containers talk on container ports via service names; localhost is the container itself.`, r`-p publishes via iptables; EXPOSE does not publish.`, r`Bind local-only services to 127.0.0.1; published ports can bypass UFW.`, r`host and none drivers for special cases; orchestrators change the model.`],
  ex: r`A developer published Postgres with -p 5432:5432 on a cloud VM protected by UFW; Docker's iptables rules exposed it to the internet until it was bound to 127.0.0.1.`,
  fu: [r`Why doesn't the default bridge network resolve container names?`, r`How does a container reach a service running on the host?`],
  pit: [r`Calling localhost to reach another container.`, r`Assuming EXPOSE publishes a port.`, r`Publishing databases on all interfaces.`] },

{ id: 'q7', level: 'Intermediate', tags: ['buildkit', 'build-cache', 'cache-mounts', 'secrets'],
  q: r`How does the Docker build cache work with BuildKit? Explain cache invalidation, .dockerignore, cache mounts, secret mounts, and remote cache backends for CI.`,
  a: r`**Cache rules**: each instruction's cache key depends on the parent layer plus the instruction text; for {{COPY}}/{{ADD}} it also includes **checksums of the copied files**. When a step's key changes, that step and **every step after it** rebuild.

**Practical consequences**
- Copy only dependency manifests first ({{*.csproj}}, {{Directory.Packages.props}}, {{nuget.config}}, {{package.json}}/{{package-lock.json}}), restore, **then** copy the rest of the source. Code changes no longer invalidate the restore layer.
- {{RUN apt-get update}} cached forever can serve stale package lists — combine {{update}} and {{install}} in one RUN, pin versions, rebuild regularly.

**.dockerignore**: excludes files from the **build context** sent to the builder — {{bin/}}, {{obj/}}, {{.git}}, {{node_modules}}, test results, local secrets ({{.env}}, {{*.pfx}}). Smaller context = faster builds, fewer accidental cache misses (changing a README no longer invalidates {{COPY . .}}), and no secrets leaking into images.

**BuildKit features** (default builder since Docker 23)
- Parallel execution of independent stages; skips unused stages.
- **Cache mounts**: {{RUN --mount=type=cache,target=/root/.nuget/packages dotnet restore}} — a persistent package cache across builds that is **not** part of the image.
- **Secret mounts**: {{RUN --mount=type=secret,id=nugetconfig,target=/root/.nuget/NuGet/NuGet.Config dotnet restore}} — private feed credentials available only during that step, never stored in a layer or history. Never pass secrets via {{ARG}}/{{ENV}}.
- **SSH mounts** for private Git dependencies.
- Heredocs in Dockerfiles, {{--mount=type=bind}} to use files without copying them.

**Remote cache for CI** (ephemeral runners have empty local caches)
- {{--cache-to type=registry,ref=registry.example/payments-api:buildcache,mode=max}} and {{--cache-from}} the same ref; or {{type=gha}} on GitHub Actions; or {{type=s3}}/{{azblob}}.
- {{mode=max}} caches intermediate stages too (better hit rate for multi-stage builds).

**Measure**: {{docker buildx build --progress=plain}} shows CACHED steps; track build duration in CI.`,
  code: r`~~~dockerfile
# syntax=docker/dockerfile:1
FROM mcr.microsoft.com/dotnet/sdk:8.0 AS build
WORKDIR /src
COPY Directory.Packages.props nuget.config ./
COPY src/Payments.Api/Payments.Api.csproj src/Payments.Api/
COPY src/Payments.Domain/Payments.Domain.csproj src/Payments.Domain/
RUN --mount=type=cache,id=nuget,target=/root/.nuget/packages \
    --mount=type=secret,id=feedtoken,env=FEED_TOKEN \
    dotnet restore src/Payments.Api/Payments.Api.csproj
COPY src/ src/
RUN --mount=type=cache,id=nuget,target=/root/.nuget/packages \
    dotnet publish src/Payments.Api/Payments.Api.csproj -c Release -o /out --no-restore
~~~
~~~bash
docker buildx build --secret id=feedtoken,env=FEED_TOKEN \
  --cache-from type=registry,ref=registry.example/payments-api:buildcache \
  --cache-to type=registry,ref=registry.example/payments-api:buildcache,mode=max \
  -t registry.example/payments-api:$GIT_SHA --push .
~~~`,
  dia: r`flowchart TD
  A[FROM sdk] --> B[COPY csproj + props]
  B --> C[RUN restore - cache mount + secret mount]
  C --> D[COPY src]
  D --> E[RUN publish]
  CH[Code change] -.invalidates from here.-> D
  DEP[Package change] -.invalidates from here.-> B
  RC[(Registry cache mode=max)] -.cache-from.-> C`,
  pts: [r`A changed step invalidates it and every later step; COPY keys include file checksums.`, r`Copy manifests, restore, then copy source.`, r`.dockerignore shrinks context, avoids cache misses and leaked secrets.`, r`BuildKit cache mounts and secret mounts keep caches and credentials out of layers.`, r`Remote cache backends make ephemeral CI builds fast.`],
  ex: r`A team's 14-minute CI image build fell to 2 minutes after splitting csproj copy from source copy, adding a NuGet cache mount and a registry cache with mode=max.`,
  fu: [r`Why can a cached apt-get update be dangerous?`, r`How do you verify a secret did not end up in an image?`],
  pit: [r`COPY . . before restore.`, r`Private feed tokens passed as ARG.`, r`No .dockerignore, sending bin/obj and .git to the builder.`] },

{ id: 'q8', level: 'Intermediate', tags: ['multi-stage', 'dotnet', 'dockerfile'],
  q: r`Write and explain a production multi-stage Dockerfile for an ASP.NET Core API: SDK versus runtime images, restore caching, running tests, publish options, and the final hardened stage.`,
  a: r`**Why multi-stage**: the SDK image (compilers, NuGet, ~800 MB+) is needed to build, not to run. A multi-stage build compiles in one stage and copies only the published output into a small **runtime** image ({{aspnet}}, ~100 MB, or chiseled ~50-110 MB depending on variant). Smaller images pull faster, start faster and carry far fewer CVEs.

**Stages**
1. **build**: SDK image; copy solution/project files and central package files; {{dotnet restore}} (cache mount); copy source; {{dotnet build}}.
2. **test** (optional target): {{dotnet test}} — run in CI with {{--target test}}, or keep tests out of the image build and run them in the pipeline directly; failing tests should fail the build.
3. **publish**: {{dotnet publish -c Release --no-restore -o /app/publish}}, options as needed:
   - {{-p:UseAppHost=false}} when you start with {{dotnet app.dll}}.
   - **ReadyToRun** ({{PublishReadyToRun}}) for faster startup at the cost of size; **trimming/Native AOT** for minimal images and fast cold starts where libraries support it (then use the {{runtime-deps}} base).
   - {{--runtime linux-x64}} / {{linux-arm64}} for RID-specific publish (pair with multi-arch builds).
4. **final**: {{aspnet:8.0-noble-chiseled}} (or {{-extra}} when you need ICU/tzdata): copy publish output, run as the built-in non-root user ({{$APP_UID}}), exec-form ENTRYPOINT, port 8080.

**Hardening in the final stage**: non-root, no shell (chiseled), no package manager, read-only rootfs at runtime, labels for provenance, no secrets.

**Alternative**: the .NET SDK can build container images without a Dockerfile ({{dotnet publish /t:PublishContainer}}) using chiseled bases and non-root defaults — good for standard apps; a Dockerfile gives more control (native dependencies, multiple projects, custom layers).`,
  code: r`~~~dockerfile
# syntax=docker/dockerfile:1
ARG DOTNET_VERSION=8.0
FROM mcr.microsoft.com/dotnet/sdk:$DOTNET_VERSION AS build
ARG TARGETARCH
WORKDIR /src
COPY Payments.sln Directory.Build.props Directory.Packages.props nuget.config ./
COPY src/Payments.Api/*.csproj src/Payments.Api/
COPY src/Payments.Domain/*.csproj src/Payments.Domain/
COPY tests/Payments.Tests/*.csproj tests/Payments.Tests/
RUN --mount=type=cache,id=nuget,target=/root/.nuget/packages dotnet restore -a $TARGETARCH
COPY . .
RUN --mount=type=cache,id=nuget,target=/root/.nuget/packages \
    dotnet build -c Release --no-restore -a $TARGETARCH

FROM build AS test
RUN dotnet test -c Release --no-build tests/Payments.Tests

FROM build AS publish
RUN dotnet publish src/Payments.Api -c Release --no-build -a $TARGETARCH -o /app/publish -p:UseAppHost=false

FROM mcr.microsoft.com/dotnet/aspnet:$DOTNET_VERSION-noble-chiseled AS final
WORKDIR /app
COPY --from=publish --chown=$APP_UID:$APP_UID /app/publish .
USER $APP_UID
ENV ASPNETCORE_HTTP_PORTS=8080
EXPOSE 8080
ENTRYPOINT ["dotnet", "Payments.Api.dll"]
~~~
~~~bash
docker buildx build --target test .                                     # CI: run tests in the build
docker buildx build --platform linux/amd64,linux/arm64 -t registry.example/payments-api:$GIT_SHA --push .
~~~`,
  dia: r`flowchart LR
  B[build: SDK ~800 MB - restore + build] --> T[test: dotnet test]
  B --> P[publish: Release output]
  P -->|COPY --from=publish| F[final: aspnet chiseled ~110 MB, non-root, no shell]
  T -.fails build on red tests.-> X[CI fails]`,
  pts: [r`Build in the SDK image, run in a minimal runtime image.`, r`Restore with project files first and a cache mount.`, r`Test as a separate target or pipeline step that fails the build.`, r`Publish options: UseAppHost, ReadyToRun, trimming/AOT, RID per architecture.`, r`Final stage: chiseled, non-root, exec form, port 8080, no secrets.`],
  ex: r`Moving a payments API from a single-stage SDK image (1.1 GB, 240 CVEs reported) to a chiseled multi-stage image (108 MB, a handful of low CVEs) cut pull time on node scale-out from 40 s to 6 s.`,
  fu: [r`When would you choose the -extra chiseled variant?`, r`Dockerfile or dotnet publish /t:PublishContainer?`],
  pit: [r`Shipping the SDK image to production.`, r`Copying the whole repo before restore.`, r`Running as root in the final stage.`] },

{ id: 'q9', level: 'Intermediate', tags: ['base-images', 'chiseled', 'alpine', 'distroless'],
  q: r`Choose a base image for .NET services: Debian/Ubuntu full, Alpine (musl), Ubuntu chiseled, distroless. Compare size, CVE surface, compatibility (ICU, time zones, native libraries) and debuggability.`,
  a: r`| Base | Size (aspnet 8) | Pros | Cons |
|---|---|---|---|
| **Debian/Ubuntu (default)** | ~220 MB | most compatible, shell and package manager for debugging, glibc | largest CVE surface; tools attackers can use |
| **Alpine** | ~110 MB | small, apk available | **musl libc**: native libraries built for glibc may break, DNS and locale behaviour differs, performance differences; ICU not included by default (globalization-invariant mode) |
| **Ubuntu chiseled** (Microsoft-published) | ~110 MB (smaller for runtime-deps) | no shell, no package manager, non-root by default, glibc compatibility, very few packages ⇒ few CVEs | no shell for debugging; base variant lacks ICU and tzdata (use {{-extra}}) |
| **Distroless** (Google/others) | small | similar philosophy | not Microsoft-supported for .NET; similar debug limits |

**Compatibility traps**
- **Globalization**: without ICU, .NET runs in **invariant mode** ({{DOTNET_SYSTEM_GLOBALIZATION_INVARIANT=true}}): culture-specific formatting, sorting and some string comparisons behave differently — dangerous for currency formatting or culture-aware sorting in banking UIs/reports. Use the {{-extra}} chiseled variant or install ICU.
- **Time zones**: {{TimeZoneInfo.FindSystemTimeZoneById("Europe/London")}} needs tzdata in the image (the {{-extra}} variant includes it).
- **Native dependencies**: libraries like SkiaSharp, SQL Server client native components, Kerberos/GSSAPI ({{libgssapi}}) for Windows auth to SQL Server, or PDF/image tools may need packages missing from chiseled — add them in a build stage or choose a fuller base.
- **Certificates**: corporate root CAs must be added (copy into the trust store in a stage that has the tooling).

**Debuggability without a shell**: ephemeral debug containers ({{kubectl debug}}, {{docker debug}} in Docker Desktop), sidecar diagnostic images with dotnet tools, {{dotnet-monitor}} as a sidecar to collect dumps/traces via HTTP.

**Recommendation**: chiseled ({{-extra}} where globalization/time zones matter) as the default for ASP.NET Core services; full Debian/Ubuntu for apps with heavy native dependencies; avoid Alpine unless you have tested musl compatibility thoroughly. Standardise via golden base images rebuilt regularly.`,
  code: r`~~~dockerfile
# Banking UI/report service: needs culture-aware formatting and time zones -> chiseled-extra
FROM mcr.microsoft.com/dotnet/aspnet:8.0-noble-chiseled-extra AS final
WORKDIR /app
COPY --from=publish --chown=$APP_UID:$APP_UID /app/publish .
USER $APP_UID
ENTRYPOINT ["dotnet", "Statements.Api.dll"]
~~~
~~~csharp
// Guard rail: fail fast at start-up if globalization is unexpectedly invariant
if (CultureInfo.GetCultureInfo("en-GB").NumberFormat.CurrencySymbol != "£")
    throw new InvalidOperationException("ICU missing: culture data unavailable (globalization-invariant image?)");
_ = TimeZoneInfo.FindSystemTimeZoneById("Europe/London");   // throws if tzdata is missing
~~~`,
  dia: r`flowchart TD
  Q[Choose base for .NET service] --> N{Heavy native deps or need shell tools?}
  N -->|yes| FULL[Debian/Ubuntu aspnet]
  N -->|no| G{Culture formatting or time zones needed?}
  G -->|yes| CX[aspnet chiseled-extra]
  G -->|no| CH[aspnet chiseled]
  N -->|AOT app| RD[runtime-deps chiseled]
  ALP[Alpine musl] -.only after compatibility testing.-> Q`,
  pts: [r`Chiseled images: no shell, non-root, glibc, minimal CVEs.`, r`Alpine uses musl: test native libs, DNS and globalization carefully.`, r`Invariant globalization changes currency and culture behaviour; use -extra or ICU.`, r`tzdata, native libraries and corporate CAs are common missing pieces.`, r`Debug shell-less images with ephemeral debug containers or dotnet-monitor.`],
  ex: r`Moving a statements service to Alpine silently switched to invariant globalization, and PDFs showed "¤" instead of "£"; the team moved to chiseled-extra and added a start-up guard.`,
  fu: [r`How do you add a corporate root CA to a chiseled image?`, r`What does DOTNET_SYSTEM_GLOBALIZATION_INVARIANT actually change?`],
  pit: [r`Alpine by default without testing musl.`, r`Shipping invariant globalization in finance UIs.`, r`Missing tzdata for TimeZoneInfo lookups.`] },

{ id: 'q10', level: 'Intermediate', tags: ['dotnet', 'containers', 'configuration', 'gc'],
  q: r`What changes when a .NET application runs in a container? Cover ports and non-root defaults in .NET 8+, configuration via environment variables, container-aware GC and CPU, HTTPS/certificates, and SDK container publishing.`,
  a: r`**Defaults since .NET 8 images**
- Default HTTP port is **8080** ({{ASPNETCORE_HTTP_PORTS}}), not 80 — because images run as the non-root **app** user (UID 1654, {{$APP_UID}}), which cannot bind ports below 1024. Update Services/ingress targetPorts when upgrading from .NET 6/7.
- Use {{USER $APP_UID}} in your Dockerfile (chiseled images already run non-root).

**Configuration**
- {{IConfiguration}} reads environment variables; hierarchical keys use **double underscore**: {{Psp__BaseUrl}} → {{Psp:BaseUrl}}. Arrays: {{AllowedOrigins__0}}.
- Keep {{appsettings.json}} for defaults; inject environment-specific values at runtime; secrets from a secret store or mounted files, not baked into images.
- {{ASPNETCORE_ENVIRONMENT}}/{{DOTNET_ENVIRONMENT}} select environment config.

**Resource awareness**
- The runtime reads **cgroup limits**: {{Environment.ProcessorCount}} reflects CPU limits (rounded), the GC **heap hard limit** defaults to 75% of the memory limit; thread-pool minimums follow processor count.
- Server GC creates heaps per core; in small containers consider Workstation GC or rely on **DATAS** (dynamic adaptation, default with Server GC in .NET 9) to keep memory proportional to load.
- Leave memory headroom for native allocations (sockets, TLS, compression buffers, thread stacks).

**HTTPS and certificates**
- Typically terminate TLS at the ingress/load balancer and run HTTP inside the cluster (or mTLS via a mesh). If Kestrel must serve HTTPS, mount the certificate (PFX/PEM) from a secret store and configure {{Kestrel:Certificates:Default}} — do not bake certificates into images.
- Outbound TLS to internal services may need corporate CAs in the image trust store.

**Diagnostics**: {{DOTNET_EnableDiagnostics}} controls the diagnostic IPC socket used by dotnet-counters/trace/dump — disable in hardened images or enable for debugging via sidecars; logs to stdout as JSON.

**SDK container publishing**: {{dotnet publish /t:PublishContainer}} builds an OCI image without a Dockerfile (chiseled base by default for supported apps, non-root, configurable via MSBuild properties such as {{ContainerRepository}}, {{ContainerImageTags}}, {{ContainerFamily}}), and can push directly to a registry — useful for standard services and environments without a Docker daemon.`,
  code: r`~~~bash
# Configuration by environment variables (double underscore = section separator)
docker run -d -p 8080:8080 \
  -e ASPNETCORE_ENVIRONMENT=Production \
  -e Psp__BaseUrl=https://api.psp.example \
  -e Psp__TimeoutSeconds=5 \
  -e DOTNET_GCHeapHardLimitPercent=0x46 \
  --memory=768m --cpus=1 registry.example/payments-api:1.4.2

# Build and push an image without a Dockerfile
dotnet publish src/Payments.Api -c Release /t:PublishContainer \
  -p:ContainerRepository=payments-api -p:ContainerRegistry=registry.example \
  -p:ContainerImageTags='"1.4.2;9c1e2f7"' -p:ContainerFamily=noble-chiseled
~~~`,
  dia: r`flowchart LR
  ENV[Env vars: Psp__BaseUrl] --> CFG[IConfiguration]
  FILE[appsettings.json defaults] --> CFG
  SEC[Mounted secrets / secret store] --> CFG
  CG[cgroup limits: --memory, --cpus] --> RT[.NET runtime: heap hard limit 75 percent, ProcessorCount]
  RT --> GC[GC mode: Server + DATAS or Workstation]
  APP[Kestrel :8080 as UID 1654] --> CFG`,
  pts: [r`.NET 8+ images listen on 8080 and run as non-root UID 1654.`, r`Environment variables configure apps with double-underscore keys.`, r`The runtime honours cgroup CPU and memory limits; tune GC for small containers.`, r`Terminate TLS at the edge or mount certificates; never bake them in.`, r`dotnet publish /t:PublishContainer builds OCI images without a Dockerfile.`],
  ex: r`An upgrade from .NET 7 to 8 broke every Kubernetes Service because targetPort was still 80; the team updated the standard chart to 8080 and added a startup log of the bound URLs.`,
  fu: [r`Why does Server GC sometimes use too much memory in small containers?`, r`How would you supply a Kestrel certificate in production?`],
  pit: [r`Assuming port 80 after .NET 8.`, r`Baking environment-specific config or secrets into images.`, r`No memory headroom beyond the GC heap.`] },

{ id: 'q11', level: 'Intermediate', tags: ['pid1', 'signals', 'tini', 'zombies'],
  q: r`Why is PID 1 special in a container? Explain signal handling, zombie reaping, docker stop timeouts, --init/tini, and how to make a .NET worker shut down gracefully.`,
  a: r`**PID 1 in Linux** has special semantics:
1. The kernel does **not apply default signal actions** to PID 1: if PID 1 has no handler for SIGTERM, the signal is ignored. (A normal process would be terminated.)
2. PID 1 is expected to **reap zombie processes**: orphaned children are re-parented to PID 1; if it never calls {{wait()}}, zombies accumulate and can exhaust the PID limit.

**docker stop** sends **SIGTERM** (or the image's {{STOPSIGNAL}}), waits **10 seconds** by default ({{--time}}/{{-t}}; Compose {{stop_grace_period}}; Kubernetes {{terminationGracePeriodSeconds}} default 30 s), then **SIGKILL** (cannot be caught).

**.NET as PID 1**: the .NET host registers SIGTERM handlers, so with **exec-form ENTRYPOINT** the app receives SIGTERM and runs graceful shutdown ({{IHostApplicationLifetime.ApplicationStopping}}, {{BackgroundService}} cancellation, Kestrel draining). It does not reap arbitrary zombies — rarely a problem unless the app spawns child processes (shelling out to tools, headless browsers for PDF rendering).

**--init / tini**: runs a tiny init as PID 1 that forwards signals to the child and reaps zombies. Use when the app spawns subprocesses or is not signal-aware (some scripts). Kubernetes equivalent: include tini in the image or use a shareProcessNamespace pod (pause container reaps).

**Graceful shutdown checklist for a .NET worker**
- Exec form; no shell wrapper (or {{exec "$@"}}).
- Honour the stopping token: stop fetching new messages, finish or release the current one, commit offsets/acks, close connections.
- {{HostOptions.ShutdownTimeout}} below the orchestrator's grace period.
- Idempotent processing, because SIGKILL after timeout can still interrupt work.
- Log shutdown start/end with durations to tune the timeouts.`,
  code: r`~~~csharp
public sealed class OutboxRelay(IOutboxStore store, IPublisher bus, ILogger<OutboxRelay> log) : BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        while (!stoppingToken.IsCancellationRequested)
        {
            var batch = await store.FetchUnpublishedAsync(100, stoppingToken);
            foreach (var msg in batch)
            {
                await bus.PublishAsync(msg, CancellationToken.None);   // finish the in-flight message even when stopping
                await store.MarkPublishedAsync(msg.Id, CancellationToken.None);
            }
            if (batch.Count == 0) await Task.Delay(TimeSpan.FromMilliseconds(500), stoppingToken);
        }
        log.LogInformation("Outbox relay stopped cleanly");
    }
}
// Program.cs: builder.Services.Configure<HostOptions>(o => o.ShutdownTimeout = TimeSpan.FromSeconds(20));
~~~
~~~bash
docker run --init -d --name renderer registry.example/pdf-renderer:3.0   # tini as PID 1: forwards signals, reaps zombies
docker stop -t 25 renderer                                               # 25 s grace before SIGKILL
~~~`,
  dia: r`sequenceDiagram
  participant D as docker stop
  participant I as PID 1 (dotnet or tini)
  participant A as App work
  D->>I: SIGTERM
  I->>A: ApplicationStopping / cancel token
  A->>A: finish current message, commit, close
  A-->>I: exit 0
  Note over D,I: if still running after grace period - SIGKILL`,
  pts: [r`PID 1 ignores signals without handlers and must reap zombies.`, r`docker stop: SIGTERM, 10 s default, then SIGKILL.`, r`.NET handles SIGTERM when it is PID 1 via exec form.`, r`--init/tini forwards signals and reaps zombies for subprocess-spawning apps.`, r`Workers stop fetching, finish or release work, commit, within the shutdown budget.`],
  ex: r`A PDF renderer that spawned headless Chromium accumulated thousands of zombie processes and hit the PID limit; running with --init (tini) fixed reaping.`,
  fu: [r`What is STOPSIGNAL used for?`, r`How do Kubernetes grace periods map to docker stop?`],
  pit: [r`Shell-form entrypoints swallowing SIGTERM.`, r`ShutdownTimeout longer than the platform grace period.`, r`Spawning subprocesses without an init process.`] },

{ id: 'q12', level: 'Intermediate', tags: ['docker-compose', 'local-development', 'healthchecks'],
  q: r`Use Docker Compose for a full-stack local environment (Angular/React SPA, .NET API, SQL Server/Postgres, Redis, a message broker): service definitions, depends_on with health checks, profiles, override files, watch mode and secrets.`,
  a: r`**Compose** describes a multi-container application in {{compose.yaml}}: services, networks (one per project by default, with service-name DNS), volumes, configs and secrets — run with {{docker compose up}}.

**Key features**
- **depends_on with conditions**: {{condition: service_healthy}} waits for a dependency's **healthcheck** to pass (plain {{depends_on}} only orders start-up, it does not wait for readiness). The API still needs retry logic — dependencies can restart later.
- **Healthchecks** per service ({{pg_isready}}, {{redis-cli ping}}, an HTTP probe).
- **Profiles**: optional services ({{--profile observability}} for Jaeger/Grafana, {{--profile tools}} for admin UIs) so the default stack stays light.
- **Override files**: {{compose.yaml}} (shared) + {{compose.override.yaml}} (developer-local, auto-loaded) or explicit {{-f compose.ci.yaml}} for CI; {{include}} to compose stacks from multiple files/teams.
- **Develop/watch** ({{docker compose watch}}): sync source changes into containers or rebuild on change — fast inner loop for the API and SPA.
- **Secrets**: file-based secrets mounted at {{/run/secrets/<name>}} instead of environment variables; {{.env}} files for non-sensitive variables (never commit real secrets).
- **Resource limits** ({{deploy.resources}}) to keep laptops usable.

**Patterns for a full-stack team**
- The SPA dev server runs on the host (fast hot reload) or in a container with watch; it proxies {{/api}} to the API container.
- Seed data and migrations via a one-shot service ({{migrator}}) that runs and exits before the API starts ({{condition: service_completed_successfully}}).
- Pin image versions identical to production dependencies (Postgres 16, Redis 7).
- Same compose file reused by **integration tests in CI**, or use Testcontainers per test suite (q30).

**Limits**: Compose is single-host; it is a development and test tool (and acceptable for small single-host deployments), not a replacement for an orchestrator in production.`,
  code: r`~~~yaml
# compose.yaml
services:
  db:
    image: postgres:16.4
    environment: { POSTGRES_DB: payments, POSTGRES_USER: app, POSTGRES_PASSWORD_FILE: /run/secrets/db_password }
    secrets: [db_password]
    volumes: [ "pgdata:/var/lib/postgresql/data" ]
    healthcheck: { test: ["CMD-SHELL", "pg_isready -U app -d payments"], interval: 5s, retries: 10 }
  redis:
    image: redis:7.4
    healthcheck: { test: ["CMD", "redis-cli", "ping"], interval: 5s, retries: 10 }
  migrator:
    build: { context: ., target: build }
    command: ["dotnet", "ef", "database", "update", "--project", "src/Payments.Infrastructure"]
    depends_on: { db: { condition: service_healthy } }
  api:
    build: .
    ports: [ "127.0.0.1:8080:8080" ]
    environment:
      ConnectionStrings__Payments: "Host=db;Database=payments;Username=app;Password_File=/run/secrets/db_password"
      Redis__Configuration: "redis:6379"
    secrets: [db_password]
    depends_on:
      migrator: { condition: service_completed_successfully }
      redis: { condition: service_healthy }
    develop:
      watch: [ { action: rebuild, path: ./src } ]
  jaeger:
    image: jaegertracing/all-in-one:1.60
    profiles: [observability]
    ports: [ "127.0.0.1:16686:16686" ]
secrets:
  db_password: { file: ./secrets/db_password.txt }      # git-ignored
volumes: { pgdata: {} }
~~~`,
  dia: r`flowchart LR
  SPA[Angular/React dev server on host :4200] -->|proxy /api| API[api :8080]
  API --> DB[(db: postgres 16 - healthy)]
  API --> RD[(redis 7 - healthy)]
  MIG[migrator - runs once] --> DB
  MIG -.completed successfully.-> API
  API -.profile observability.-> JG[jaeger]`,
  pts: [r`Compose defines services, networks, volumes and secrets for one host.`, r`depends_on with service_healthy waits for health; apps still need retries.`, r`Profiles keep optional tools out of the default stack; overrides per developer or CI.`, r`Watch mode for a fast inner loop; one-shot migrator services.`, r`File-based secrets, pinned versions, local-only port bindings.`],
  ex: r`A full-stack team cut onboarding from two days to 30 minutes with one compose file: database, Redis, broker, migrator and API, plus an observability profile.`,
  fu: [r`Why doesn't plain depends_on guarantee the database is ready?`, r`When would you replace compose-based integration tests with Testcontainers?`],
  pit: [r`Relying on start order instead of health checks and retries.`, r`Committing .env files with real secrets.`, r`Publishing dev databases on all interfaces.`] },

{ id: 'q13', level: 'Intermediate', tags: ['healthcheck', 'probes', 'readiness'],
  q: r`Docker HEALTHCHECK versus orchestrator probes: what does the Dockerfile HEALTHCHECK do, who acts on it, how do you implement checks in chiseled .NET images without curl, and what should a health endpoint check?`,
  a: r`**Dockerfile HEALTHCHECK**: the Docker engine runs a command inside the container periodically ({{--interval}}, {{--timeout}}, {{--start-period}}, {{--retries}}) and marks it {{healthy}}/{{unhealthy}} in {{docker ps}}.
- **Docker itself does not restart unhealthy containers** (only on exit, via restart policies). Compose uses health for {{depends_on: condition: service_healthy}}; Swarm replaces unhealthy tasks.
- **Kubernetes ignores HEALTHCHECK** entirely — it uses liveness, readiness and startup probes defined in the pod spec. ECS supports container health checks in the task definition (similar semantics to HEALTHCHECK, usually defined there).

**Implementation in shell-less images**: {{HEALTHCHECK CMD curl ...}} fails in chiseled/distroless images (no curl, no shell). Options:
- Rely on the orchestrator's HTTP probes (the usual production answer).
- A tiny health-check executable compiled into the image (a small .NET console app or the app itself with a {{--healthcheck}} argument that calls {{http://localhost:8080/health/live}} and exits 0/1).
- Exec form only ({{HEALTHCHECK CMD ["/app/healthcheck"]}}).

**What a health endpoint should check** (mirrors q3 in the Kubernetes topic)
- **Liveness**: the process can respond; no dependency checks.
- **Readiness**: the instance can do useful work (warm-up complete, essential local resources, a cheap check of the primary dependency with a tight timeout).
- Keep checks cheap, unauthenticated but not exposed publicly (or with minimal info), and avoid leaking versions/connection details in responses.

**Common mistakes**: health checks that hit the database every few seconds from every replica, checks that take longer than the timeout under load, and using HEALTHCHECK in images destined for Kubernetes and assuming it does something.`,
  code: r`~~~csharp
// Program.cs: the app doubles as its own health-check client (no curl needed in chiseled images)
if (args.Contains("--healthcheck"))
{
    using var http = new HttpClient { Timeout = TimeSpan.FromSeconds(3) };
    try { return (await http.GetAsync("http://localhost:8080/health/live")).IsSuccessStatusCode ? 0 : 1; }
    catch { return 1; }
}
var builder = WebApplication.CreateBuilder(args);
builder.Services.AddHealthChecks().AddCheck("self", () => HealthCheckResult.Healthy(), tags: ["live"]);
var app = builder.Build();
app.MapHealthChecks("/health/live", new() { Predicate = c => c.Tags.Contains("live") });
await app.RunAsync();
return 0;
~~~
~~~dockerfile
HEALTHCHECK --interval=10s --timeout=3s --start-period=30s --retries=3 \
  CMD ["dotnet", "Payments.Api.dll", "--healthcheck"]
~~~`,
  dia: r`flowchart LR
  HC[Dockerfile HEALTHCHECK] --> ENG[Docker engine: healthy / unhealthy]
  ENG --> CMP[Compose depends_on service_healthy]
  ENG --> SW[Swarm replaces task]
  ENG -.no restart by itself.-> X[Plain docker run]
  K8S[Kubernetes] -->|ignores HEALTHCHECK| PR[liveness / readiness / startup probes]`,
  pts: [r`HEALTHCHECK marks status; Docker does not restart unhealthy containers by itself.`, r`Compose and Swarm act on it; Kubernetes ignores it and uses probes.`, r`Shell-less images need exec-form checks or a built-in health client.`, r`Liveness without dependencies; readiness cheap and bounded.`, r`Do not leak details from health endpoints.`],
  ex: r`A team relied on HEALTHCHECK to restart hung containers on plain Docker hosts; nothing restarted until they added an orchestrator (or autoheal tooling) that acts on health status.`,
  fu: [r`What does --start-period protect against?`, r`How does ECS use container health checks?`],
  pit: [r`curl-based checks in chiseled images.`, r`Assuming Kubernetes uses HEALTHCHECK.`, r`Database calls in every liveness check.`] },

{ id: 'q14', level: 'Intermediate', tags: ['logging', 'stdout', 'log-drivers', 'rotation'],
  q: r`How should containerised .NET services log? Explain stdout/stderr, Docker logging drivers, log rotation, structured JSON logging, and shipping logs to a central platform without leaking sensitive data.`,
  a: r`**Twelve-factor rule**: write logs to **stdout/stderr** as an event stream; the platform collects, routes and stores them. Do not write log files inside the container (lost on restart, fill the writable layer, need rotation).

**Docker logging drivers**
- **json-file** (default): writes each line as JSON on the host under {{/var/lib/docker/containers/<id>}}. **No rotation by default** — set {{max-size}} and {{max-file}} (daemon-wide in {{daemon.json}} or per container), or disks fill up.
- **local**: compressed, rotated by default, efficient; {{docker logs}} still works.
- **journald**, **syslog**, **fluentd**, **awslogs**, **gcplogs**, **splunk**: ship directly. Remote drivers can block or drop when the destination is slow ({{mode=non-blocking}} with a buffer trades possible loss for app latency).
- In Kubernetes, the container runtime writes logs to node files; a DaemonSet (Fluent Bit, Vector, OTel Collector) tails and ships them.

**Structured logging in .NET**
- JSON console formatter ({{AddJsonConsole}}) or Serilog with a compact JSON formatter: one JSON object per line with timestamp, level, message template, properties, **trace and span ids** (W3C), correlation id, service name, version, environment.
- Use message templates ({{"Payment {PaymentId} authorised in {ElapsedMs} ms"}}) so properties are queryable — not string interpolation.
- Avoid multi-line output (stack traces as single JSON fields), excessive verbosity at Information level, and per-request debug logs in production.

**Sensitive data**: never log PANs, CVVs, full account numbers, passwords, tokens or personal data beyond policy. Enforce with logging filters/redaction ({{Microsoft.Extensions.Compliance.Redaction}} with data classification attributes), scrubbing in the collector, and tests that scan log output. Regulators treat logs containing card data as in PCI scope.

**Cost and retention**: sample or drop noisy debug logs at the collector, set retention per stream, archive to cheap storage for audit needs; metrics for counts instead of logging every event.`,
  code: r`~~~csharp
builder.Logging.ClearProviders();
builder.Logging.AddJsonConsole(o =>
{
    o.IncludeScopes = true;
    o.TimestampFormat = "yyyy-MM-ddTHH:mm:ss.fffZ";
    o.UseUtcTimestamp = true;
});
// Redaction for classified data (Microsoft.Extensions.Compliance.Redaction)
builder.Services.AddRedaction(r => r.SetRedactor<ErasingRedactor>(new DataClassificationSet(FinanceData.CardNumber)));
builder.Logging.EnableRedaction();

public partial class PaymentLog
{
    [LoggerMessage(Level = LogLevel.Information, Message = "Payment {PaymentId} authorised for card {CardNumber}")]
    public static partial void Authorised(ILogger logger, string paymentId, [CardNumberData] string cardNumber); // redacted
}
~~~
~~~json
// /etc/docker/daemon.json - rotation for plain Docker hosts
{ "log-driver": "local", "log-opts": { "max-size": "20m", "max-file": "5" } }
~~~`,
  dia: r`flowchart LR
  APP[.NET app: JSON logs to stdout, redacted] --> RT[Container runtime / logging driver]
  RT --> FILE[Node log files - rotated]
  FILE --> AG[Fluent Bit / OTel Collector DaemonSet]
  AG -->|scrub, sample, enrich with k8s metadata| CENTRAL[Central log platform]
  CENTRAL --> ARC[(Archive for audit retention)]`,
  pts: [r`Log to stdout/stderr; the platform ships logs.`, r`json-file has no rotation by default; configure max-size/max-file or use local.`, r`Structured JSON with message templates and trace ids.`, r`Redact sensitive data in code and at the collector; test for leaks.`, r`Control cost with sampling, retention and metrics instead of logs.`],
  ex: r`A Docker host running a chatty service filled its root disk with unrotated json-file logs and took down every container on it; daemon-wide log rotation became part of the host baseline.`,
  fu: [r`What happens when a remote logging driver's destination is down?`, r`How do you prove PANs never reach the log platform?`],
  pit: [r`Unrotated json-file logs.`, r`String interpolation in log messages.`, r`Logging card numbers or tokens.`] },

{ id: 'q15', level: 'Intermediate', tags: ['registries', 'tagging', 'digests', 'rate-limits'],
  q: r`Design image tagging and registry practices: semantic versions versus commit SHAs versus latest, immutable tags, digests in deployments, retention policies, pull-through caches and public registry rate limits.`,
  a: r`**Tagging strategy**
- **Commit SHA tag** ({{payments-api:9c1e2f7}}) for every CI build: unique, traceable to source.
- **Semantic version tags** ({{1.4.2}}) for releases (and optionally {{1.4}}, {{1}} for consumers of shared base images).
- **latest**: convenient for humans, dangerous for deployments — it moves, so two nodes can run different code under the same name, rollbacks are ambiguous, and caches hide changes. Never deploy {{latest}}.
- Deploy by **digest** ({{@sha256:...}}) — immutable by construction; GitOps manifests record exactly what runs. Tags are for humans; digests are for machines.

**Registry controls**
- **Tag immutability** (ECR, ACR, Artifact Registry, Harbor settings) so a published tag cannot be overwritten.
- **Push only from CI** identities; humans pull only.
- **Vulnerability scanning** on push and continuously; block or flag images with critical issues.
- **Retention/lifecycle policies**: delete untagged images and old SHA-tagged builds after N days, keep release tags and anything currently deployed (query clusters/GitOps before deleting). Storage costs and scan noise grow without this.
- **Replication** to each region where clusters run (pull latency, regional resilience, data transfer cost).
- Private connectivity to the registry (VPC endpoints/private link).

**Public registries and rate limits**: Docker Hub applies pull rate limits to anonymous and free accounts (tightened over the years), and public registries can have outages. A fleet of nodes pulling {{postgres:16}} during scale-out can hit limits and fail deployments.
- Use a **pull-through cache** (ECR pull-through cache, ACR artifact cache, Harbor proxy cache, Artifactory) for upstream images.
- Better: **mirror approved base images** into your registry, scan and re-tag them as golden images; admission policy allows only your registry.
- Authenticate pulls where public sources must be used.

**Promotion**: the same digest moves through dev → staging → prod (re-tag or copy between registries/repositories with tools like {{crane}}/{{oras}}), never rebuilt per environment.`,
  code: r`~~~bash
# CI: tag by SHA (and release version), push, record the digest for GitOps
docker buildx build -t registry.example/payments-api:$GIT_SHA -t registry.example/payments-api:1.4.2 --push .
DIGEST=$(crane digest registry.example/payments-api:$GIT_SHA)
yq -i ".images[0].digest = \"$DIGEST\"" deploy/overlays/dev/kustomization.yaml

# Mirror an approved upstream base image into the internal registry (golden image)
crane copy mcr.microsoft.com/dotnet/aspnet:8.0-noble-chiseled registry.example/base/aspnet:8.0-noble-chiseled-2026-10-11
~~~
~~~json
// ECR lifecycle policy: expire untagged images after 7 days, keep the last 200 SHA builds
{ "rules": [
  { "rulePriority": 1, "selection": { "tagStatus": "untagged", "countType": "sinceImagePushed", "countUnit": "days", "countNumber": 7 }, "action": { "type": "expire" } },
  { "rulePriority": 2, "selection": { "tagStatus": "tagged", "tagPrefixList": ["sha-"], "countType": "imageCountMoreThan", "countNumber": 200 }, "action": { "type": "expire" } } ] }
~~~`,
  dia: r`flowchart LR
  CI[CI build] -->|tag SHA + semver, push| REG[(Internal registry: immutable tags, scanning, retention)]
  UP[Docker Hub / MCR upstream] -->|pull-through cache / mirror| REG
  REG -->|replicate| REG2[(Regional registry)]
  REG -->|digest in GitOps| DEV[Dev cluster]
  REG -->|same digest| PROD[Prod cluster]
  REG2 --> PROD`,
  pts: [r`Tag builds by commit SHA, releases by semver; never deploy latest.`, r`Deploy by digest; tags are for humans.`, r`Immutable tags, CI-only push, scanning, retention, regional replication.`, r`Pull-through caches or mirrored golden images avoid rate limits and outages.`, r`Promote the same digest; never rebuild per environment.`],
  ex: r`A scale-out event failed when 40 new nodes hit Docker Hub's anonymous pull limits for a sidecar image; mirroring all third-party images into ECR removed the dependency.`,
  fu: [r`How do you safely delete old images without breaking running workloads?`, r`Why does deploying by digest simplify incident forensics?`],
  pit: [r`latest in production manifests.`, r`Overwritable release tags.`, r`Pulling third-party images directly from public registries at scale.`] },

{ id: 'q16', level: 'Intermediate', tags: ['image-size', 'startup', 'aot', 'readytorun'],
  q: r`Optimise image size and container start-up time for .NET services: what drives size, ReadyToRun versus trimming versus Native AOT, layer strategy, and how image size affects scale-out and cost.`,
  a: r`**Why it matters**: every new node or task must **pull** the image before starting. A 1 GB image over a congested NAT can take tens of seconds; during a traffic spike or node replacement, slow pulls delay scale-out exactly when capacity is needed. Image size also drives registry storage, egress cost and CVE count.

**What drives size**
- Base image choice (SDK vs runtime vs chiseled; q9).
- App output: framework-dependent publish is small (runtime in the base layer); self-contained adds the runtime (~70 MB) to your layer.
- Leftovers: build tools, caches, test assets, PDBs, unused native libraries for other platforms.

**Start-up time drivers**: image pull, runtime start, **JIT compilation**, DI container construction, configuration loading, cache warm-up, connection pool establishment.

**Options**
| Technique | Effect | Trade-offs |
|---|---|---|
| **ReadyToRun** ({{PublishReadyToRun}}) | precompiled native code alongside IL; faster start-up | larger output; tiered JIT still optimises later |
| **Trimming** ({{PublishTrimmed}}) | removes unused framework code (self-contained) | reflection-heavy code can break; needs trim-safe libraries |
| **Native AOT** ({{PublishAot}}) | single native binary, no JIT, very fast start-up (tens of ms), small images on {{runtime-deps}} chiseled | no runtime code generation; limited library support (reflection-based serialization/EF Core features); longer builds; check ASP.NET Core feature support |
| Tiered PGO / dynamic PGO (default) | better steady-state performance | — |

**Layer strategy**: put the base and rarely changing dependencies in lower layers so nodes reuse them (shared golden base across services means one cached base layer for all); app binaries in the top layer. Avoid huge single layers that change every build.

**Pull optimisation at scale**: regional registries, VPC endpoints instead of NAT, pre-pulled images on node images (for system/sidecar images), lazy-loading/streaming snapshotters (SOCI on AWS Fargate, image streaming on GKE, artifact streaming on Azure) for large images.

**Measure**: image size and pull time in CI dashboards, time-to-ready per pod, cold-start latency; set budgets (for example API images under 150 MB, ready in under 5 seconds).`,
  code: r`~~~xml
<!-- Payments.Api.csproj: choose per workload -->
<PropertyGroup>
  <!-- Typical API: framework-dependent + ReadyToRun on chiseled aspnet -->
  <PublishReadyToRun>true</PublishReadyToRun>
  <InvariantGlobalization>false</InvariantGlobalization>
</PropertyGroup>
<!-- Short-lived function/worker with simple dependencies: Native AOT on runtime-deps chiseled -->
<PropertyGroup Condition="'$(AotBuild)' == 'true'">
  <PublishAot>true</PublishAot>
  <StripSymbols>true</StripSymbols>
</PropertyGroup>
~~~
~~~bash
docker images registry.example/payments-api --format '{{.Tag}} {{.Size}}'
docker buildx imagetools inspect registry.example/payments-api:1.4.2 --format '{{json .Manifest.Layers}}' | jq '[.[].size] | add/1048576'
~~~`,
  dia: r`flowchart LR
  BASE[Golden base layer - shared, cached on nodes] --> APP[App layer - changes each build]
  APP --> PULL[Pull on scale-out]
  PULL --> START[Runtime start + JIT + DI]
  R2R[ReadyToRun] -.reduces JIT.-> START
  AOT[Native AOT] -.no JIT, tiny image.-> START
  STREAM[Lazy-loading snapshotters] -.start before full pull.-> PULL`,
  pts: [r`Image size affects scale-out speed, cost and CVE count.`, r`ReadyToRun cuts JIT time; trimming and Native AOT shrink and speed up with compatibility limits.`, r`Share golden base layers; keep frequently changing content in the top layer.`, r`Regional registries, endpoints and lazy-loading snapshotters speed pulls.`, r`Set and track size and time-to-ready budgets.`],
  ex: r`A card-authorisation API cut time-to-ready on node replacement from 48 s to 9 s by moving to a chiseled base shared across services, ReadyToRun, and a regional registry behind a VPC endpoint.`,
  fu: [r`What breaks when you enable Native AOT on an ASP.NET Core app using EF Core?`, r`How do lazy-loading snapshotters change start-up?`],
  pit: [r`Self-contained publishes on top of a runtime image (runtime twice).`, r`Ignoring pull time in scaling plans.`, r`Enabling trimming without testing reflection paths.`] },

{ id: 'q17', level: 'Intermediate', tags: ['multi-arch', 'buildx', 'arm64', 'graviton'],
  q: r`Build and run multi-architecture images (amd64 and arm64) for .NET services: buildx, emulation versus native builders, RID-specific publish, and the cost and compatibility case for ARM servers.`,
  a: r`**Why multi-arch**: ARM servers (AWS Graviton, Azure Cobalt/Ampere, GCP Axion/Tau T2A) often give **20-40% better price-performance** for .NET workloads; developers on Apple Silicon run arm64 locally. One tag should work everywhere via an **image index**.

**Building**
- {{docker buildx build --platform linux/amd64,linux/arm64 --push}} produces one manifest per platform plus an index.
- **Emulation (QEMU)**: easy, but running the SDK under emulation is **very slow** (often 5-10x) and occasionally flaky.
- **Better for .NET**: build on the native platform (separate amd64 and arm64 runners, combined with {{docker buildx imagetools create}}), or **cross-compile**: run the SDK stage on the build platform ({{FROM --platform=$BUILDPLATFORM}}) and publish for the target RID ({{-a $TARGETARCH}}) — .NET compiles IL anywhere; only the final stage uses the target-platform runtime image.
- Native AOT needs a toolchain for the target architecture (cross-compiling AOT is more involved — native runners are simpler).

**Compatibility checks**
- Native dependencies (NuGet packages with native assets: SkiaSharp, gRPC tools, database drivers, compression libraries) must ship arm64 binaries.
- Sidecars and agents (monitoring, security, mesh) must publish arm64 images.
- Performance-test on target hardware — most .NET code runs as fast or faster per dollar, but hot paths with x86-specific intrinsics may differ.

**Running**: Kubernetes schedules by {{kubernetes.io/arch}}; mixed node pools need multi-arch images for every component or node affinity. Karpenter/node autoprovisioning can choose ARM when images support it.

**Rollout strategy**: build multi-arch for all services first; move non-critical services to ARM pools; compare latency/cost; then migrate critical paths with canaries.`,
  code: r`~~~dockerfile
# syntax=docker/dockerfile:1
# SDK runs natively on the build machine; output targets each platform's architecture
FROM --platform=$BUILDPLATFORM mcr.microsoft.com/dotnet/sdk:8.0 AS build
ARG TARGETARCH
WORKDIR /src
COPY src/Payments.Api/*.csproj src/Payments.Api/
RUN dotnet restore src/Payments.Api -a $TARGETARCH
COPY src/ src/
RUN dotnet publish src/Payments.Api -c Release -a $TARGETARCH --no-restore -o /out -p:UseAppHost=false

FROM mcr.microsoft.com/dotnet/aspnet:8.0-noble-chiseled
WORKDIR /app
COPY --from=build --chown=$APP_UID:$APP_UID /out .
USER $APP_UID
ENTRYPOINT ["dotnet", "Payments.Api.dll"]
~~~
~~~bash
docker buildx create --use --name multi
docker buildx build --platform linux/amd64,linux/arm64 -t registry.example/payments-api:$GIT_SHA --push .
docker buildx imagetools inspect registry.example/payments-api:$GIT_SHA
~~~`,
  dia: r`flowchart LR
  SDK[SDK stage on BUILDPLATFORM amd64] -->|publish -a amd64| F1[final linux/amd64]
  SDK -->|publish -a arm64| F2[final linux/arm64]
  F1 --> IDX[Image index: one tag]
  F2 --> IDX
  IDX --> N1[x86 nodes]
  IDX --> N2[Graviton / Cobalt nodes]`,
  pts: [r`ARM servers often give 20-40% better price-performance for .NET.`, r`buildx produces per-platform manifests under one image index.`, r`Avoid slow QEMU SDK builds: cross-compile with BUILDPLATFORM or native runners.`, r`Check native NuGet assets, sidecars and agents for arm64.`, r`Roll out gradually with performance comparisons.`],
  ex: r`A fintech moved 30 .NET services to Graviton after making images multi-arch; one image-processing service with an x86-only native library stayed on amd64 via node affinity, and compute cost fell by about 25% overall.`,
  fu: [r`Why is cross-compiling .NET easier than cross-compiling Native AOT?`, r`How do you handle a sidecar without an arm64 image?`],
  pit: [r`Building the SDK stage under QEMU emulation.`, r`Assuming all native NuGet dependencies support arm64.`, r`Mixed-architecture pools with single-arch images.`] },

{ id: 'q18', level: 'Intermediate', tags: ['secrets', 'build-args', 'environment', 'image-history'],
  q: r`How do secrets leak through images and containers (ENV, ARG, layers, history, inspect, logs), and what is the correct way to provide secrets at build time and at runtime?`,
  a: r`**Leak paths**
- **ENV in the Dockerfile**: stored in the image config — visible to anyone who can pull the image ({{docker inspect}}, {{docker history}}).
- **ARG**: values used by {{RUN}} steps appear in image history/build metadata; ARGs are not secret.
- **COPY of secret files** (even if deleted later): the file remains in an earlier layer and can be extracted from the image tarball.
- **Build context**: without {{.dockerignore}}, {{.env}}, PFX files and cloud credential files are sent to the builder and may be copied by {{COPY . .}}.
- **Runtime environment variables**: visible via {{docker inspect}} to anyone with Docker API access, in {{/proc/<pid>/environ}}, in crash dumps, and often printed by debug endpoints or logs at start-up.
- **Logs and exceptions** that print connection strings.

**Build time — correct**
- **BuildKit secret mounts**: {{RUN --mount=type=secret,id=nuget ...}} with {{docker buildx build --secret id=nuget,src=...}} — available only during that step, never in a layer.
- SSH mounts for private Git dependencies.
- Prefer short-lived tokens (CI OIDC-issued feed tokens) over long-lived PATs.

**Runtime — correct, in order of preference**
1. **No secret**: workload identity (IAM roles, managed identities) for cloud services and databases supporting token auth.
2. **Secret store** at runtime (Secrets Manager, Key Vault, Vault) via SDK/config provider with caching and rotation.
3. **Mounted files** (Docker/Compose secrets at {{/run/secrets}}, Kubernetes secret volumes via External Secrets/CSI) — better than env vars (not in inspect output or process environment).
4. Environment variables only for low-sensitivity values or when the platform injects them securely (and never logged).

**Detect**: secret scanning on repos and images (trufflehog, gitleaks, registry scanners), {{docker history --no-trunc}} review in CI, and policies blocking images with secrets.`,
  code: r`~~~dockerfile
# syntax=docker/dockerfile:1
FROM mcr.microsoft.com/dotnet/sdk:8.0 AS build
WORKDIR /src
COPY nuget.config *.csproj ./
# Private feed credentials exist only for this step; nothing is written to a layer
RUN --mount=type=secret,id=feed_pat,env=FEED_PAT \
    dotnet nuget update source internal --username ci --password "$FEED_PAT" --store-password-in-clear-text --configfile /tmp/nuget.config \
 && dotnet restore --configfile /tmp/nuget.config \
 && rm /tmp/nuget.config
~~~
~~~bash
docker buildx build --secret id=feed_pat,env=FEED_PAT -t registry.example/payments-api:$GIT_SHA .
docker history --no-trunc registry.example/payments-api:$GIT_SHA | grep -i -E 'pat|password|token' && exit 1 || true
# Runtime: file-based secret instead of an environment variable
docker run -d --name api -v "$PWD/secrets/psp_api_key:/run/secrets/psp_api_key:ro" registry.example/payments-api:$GIT_SHA
~~~`,
  dia: r`flowchart LR
  BAD1[ENV / ARG in Dockerfile] -->|visible in history, inspect| LEAK[Leaked to anyone who pulls]
  BAD2[COPY secret then delete] -->|still in lower layer| LEAK
  GOOD1[BuildKit secret mount] -->|only during one RUN| IMG[Clean image]
  GOOD2[Workload identity] --> RUN[Runtime: no secret at all]
  GOOD3[Secret store / mounted file] --> RUN`,
  pts: [r`ENV, ARG, copied files and build context all leak secrets into images.`, r`Runtime env vars are visible via inspect, /proc and dumps.`, r`Use BuildKit secret mounts at build time.`, r`At runtime prefer workload identity, then secret stores, then mounted files.`, r`Scan repos and images for secrets in CI.`],
  ex: r`A public image of an internal tool contained an Azure DevOps PAT passed as an ARG; image history exposed it and it was used to read private repos before rotation.`,
  fu: [r`Why is a file-mounted secret safer than an environment variable?`, r`How would you find secrets in an existing registry?`],
  pit: [r`Passing tokens as ARG.`, r`Deleting secret files in later layers.`, r`Logging configuration at start-up including secrets.`] },

{ id: 'q19', level: 'Senior', tags: ['namespaces', 'cgroups', 'runtime-internals'],
  q: r`Go deep on container runtime internals: what each Linux namespace isolates, how cgroups v2 enforces limits, what runc does step by step, and what remains shared with the host.`,
  a: r`**Namespaces** (what the process can see)
| Namespace | Isolates |
|---|---|
| **PID** | process IDs; the container's first process is PID 1; cannot see host processes |
| **NET** | interfaces, IPs, routes, iptables, ports |
| **MNT** | mount table → its own root filesystem view |
| **UTS** | hostname, domain name |
| **IPC** | System V IPC, POSIX message queues, shared memory |
| **USER** | UID/GID mapping — root inside can map to an unprivileged UID outside (rootless/userns-remap) |
| **CGROUP** | view of the cgroup hierarchy |
| **TIME** | (newer) clock offsets |

**cgroups v2** (what the process can use): a single unified hierarchy; controllers for **cpu** ({{cpu.max}} quota/period → throttling; {{cpu.weight}} → shares under contention), **memory** ({{memory.max}} → OOM kill; {{memory.high}} → throttling/reclaim before OOM), **io** (bandwidth/IOPS), **pids** ({{pids.max}} — fork-bomb protection). Also accounting used by metrics (cAdvisor reads cgroup files). Pressure Stall Information (PSI) exposes resource pressure.

**What runc does** (simplified)
1. Reads the OCI bundle ({{config.json}} + rootfs).
2. Creates namespaces ({{clone}}/{{unshare}}), configures the cgroup.
3. Sets up mounts: rootfs via {{pivot_root}}, {{/proc}}, {{/dev}}, {{/sys}} (read-only parts), masked paths ({{/proc/kcore}} etc.).
4. Applies security: drops capabilities to the configured set, sets {{no_new_privs}}, loads the **seccomp** filter, applies AppArmor/SELinux labels, switches UID/GID.
5. {{execve}}s the entrypoint; runc exits, the shim remains parent.

**Still shared with the host**: the **kernel** (syscalls, kernel bugs, kernel modules), the kernel's view of time (mostly), hardware, some {{/proc}} and {{/sys}} information unless masked, and resources not fully isolated (CPU caches, memory bandwidth, network/disk I/O contention). This is why kernel CVEs (for example in overlayfs, netfilter or cgroups release_agent) can enable escapes, and why seccomp, capabilities and user namespaces matter.

**Practical inspection**: {{nsenter}} into a container's namespaces from the host, {{lsns}}, reading cgroup files under {{/sys/fs/cgroup}} to check limits and throttling.`,
  code: r`~~~bash
PID=$(docker inspect -f '{{.State.Pid}}' api)
sudo lsns -p "$PID"                                       # namespaces of the container process
CG=$(cat /proc/$PID/cgroup | cut -d: -f3)
cat /sys/fs/cgroup$CG/cpu.max /sys/fs/cgroup$CG/memory.max /sys/fs/cgroup$CG/pids.max
cat /sys/fs/cgroup$CG/cpu.stat | grep -E 'nr_throttled|throttled_usec'   # CFS throttling evidence
sudo nsenter -t "$PID" -n ss -ltnp                       # enter only the network namespace: listening sockets
grep -E 'Cap(Eff|Bnd)' /proc/$PID/status                 # effective capabilities
~~~`,
  dia: r`flowchart TB
  RUNC[runc] --> NS[Create namespaces: pid, net, mnt, uts, ipc, user, cgroup]
  RUNC --> CG[Configure cgroup v2: cpu.max, memory.max, pids.max]
  RUNC --> MNT[pivot_root, mount proc/dev/sys, mask paths]
  RUNC --> SEC[Drop caps, no_new_privs, seccomp, AppArmor/SELinux, setuid]
  SEC --> EXEC[execve entrypoint]
  EXEC --> K[Shared host kernel]`,
  pts: [r`Namespaces control visibility: PID, NET, MNT, UTS, IPC, USER, CGROUP, TIME.`, r`cgroups v2 enforce CPU (quota/weight), memory (max/high), IO and PIDs.`, r`runc: namespaces, cgroups, mounts, security filters, then execve.`, r`The kernel and some resources remain shared: kernel bugs can enable escapes.`, r`Inspect with lsns, nsenter and cgroup files.`],
  ex: r`Diagnosing a latency issue, an engineer read cpu.stat in the container's cgroup and found nr_throttled climbing on every request burst — proof of CFS throttling that dashboards had averaged away.`,
  fu: [r`What does a user namespace change for a process that is root inside the container?`, r`What is the difference between memory.high and memory.max?`],
  pit: [r`Treating namespaces as a security boundary equal to a VM.`, r`Forgetting the pids controller (fork bombs).`, r`Assuming cgroups isolate noisy neighbours completely.`] },

{ id: 'q20', level: 'Senior', tags: ['security', 'hardening', 'capabilities', 'rootless'],
  q: r`Harden containers at runtime: non-root users, read-only root filesystems, capabilities, no-new-privileges, seccomp and AppArmor/SELinux, user namespaces and rootless Docker. What does --privileged really grant?`,
  a: r`**Defence in depth at runtime**
- **Non-root user**: {{USER $APP_UID}} in the image; verify at runtime ({{--user}}). Root in a container is UID 0 on the host kernel (without user namespaces) — any escape is a root escape.
- **Read-only root filesystem** ({{--read-only}} + tmpfs for {{/tmp}}): blocks dropping tools/binaries into the container and tampering with app files.
- **Capabilities**: Docker's default set already drops many, but keeps some (for example {{NET_RAW}}, {{CHOWN}}, {{SETUID}}); use {{--cap-drop=ALL}} and add back only what is needed (a .NET API on port 8080 needs none).
- **no-new-privileges** ({{--security-opt no-new-privileges}}): setuid binaries cannot raise privileges.
- **seccomp**: the default profile blocks ~40+ dangerous syscalls (mount, kernel module loading, keyctl...); never run {{seccomp=unconfined}}; custom profiles for high-security workloads.
- **AppArmor/SELinux**: mandatory access control confining file and capability use (docker-default AppArmor profile; SELinux labels on RHEL).
- **Resource limits**: memory, CPU, {{--pids-limit}} (fork bombs).
- **Networking**: no host network, publish only necessary ports.

**User namespaces and rootless**
- **userns-remap**: root inside maps to an unprivileged UID range outside — an escape lands as nobody.
- **Rootless Docker/Podman**: the daemon and containers run as an unprivileged user; compromise of the daemon is not host root. Some features are limited (privileged ports, certain network modes, some storage drivers).

**--privileged** grants **all capabilities**, disables seccomp and AppArmor confinement, gives access to **all host devices** ({{/dev}}), and allows mounting filesystems — effectively root on the host (mount the host disk, load kernel modules, read every container's data). Equivalent dangers: mounting {{/var/run/docker.sock}} (full control of Docker = root), {{--pid=host}}, {{--net=host}} for sensitive cases, hostPath mounts of {{/}} or {{/etc}}.

**Verification**: CIS Docker Benchmark ({{docker-bench-security}}), image linting (hadolint, Dockle), admission policies in orchestrators, runtime detection (Falco) for shells spawned in containers or unexpected outbound connections.`,
  code: r`~~~bash
docker run -d --name payments \
  --user 1654:1654 \
  --read-only --tmpfs /tmp:rw,noexec,nosuid,size=64m \
  --cap-drop=ALL \
  --security-opt no-new-privileges:true \
  --security-opt seccomp=/etc/docker/seccomp/payments.json \
  --memory=768m --cpus=1 --pids-limit=256 \
  -p 127.0.0.1:8080:8080 \
  registry.example/payments-api@sha256:9c1e...
docker run --rm --net host --pid host -v /etc:/etc:ro -v /var/run/docker.sock:/var/run/docker.sock:ro \
  docker/docker-bench-security                               # CIS Docker Benchmark checks
~~~`,
  dia: r`flowchart LR
  P[Container process] --> U[Non-root UID 1654 / userns remap]
  P --> RO[Read-only rootfs + tmpfs noexec]
  P --> CAP[cap-drop ALL]
  P --> NNP[no-new-privileges]
  P --> SC[seccomp default or custom]
  P --> MAC[AppArmor / SELinux]
  P --> LIM[memory, cpus, pids-limit]
  PRIV[--privileged or docker.sock mount] -.bypasses all layers.-> HOST[Host root]`,
  pts: [r`Run non-root with a read-only rootfs and tmpfs.`, r`Drop all capabilities; add back only what is required.`, r`no-new-privileges, seccomp and AppArmor/SELinux always on.`, r`User namespaces or rootless runtimes turn escapes into unprivileged access.`, r`--privileged or docker.sock mounts equal host root.`],
  ex: r`A CI job ran build containers with --privileged for convenience; a malicious dependency mounted the host disk and harvested credentials from other jobs. Rootless BuildKit replaced it.`,
  fu: [r`Which capability would a .NET API binding to port 443 need, and how do you avoid it?`, r`What limitations does rootless Docker introduce?`],
  pit: [r`Running containers as root by default.`, r`--privileged for debugging convenience.`, r`seccomp=unconfined to fix an obscure error.`] },

{ id: 'q21', level: 'Senior', tags: ['docker-socket', 'dind', 'kaniko', 'ci-builds'],
  q: r`Why is exposing the Docker socket dangerous, and how should CI build images securely — Docker-in-Docker, socket mounting, Kaniko, Buildah, or rootless BuildKit? Compare the options for a shared Kubernetes-based CI.`,
  a: r`**The Docker socket is root**: any process that can talk to {{/var/run/docker.sock}} can run {{docker run --privileged -v /:/host ...}} and own the host. Mounting the socket into a CI job or an app container (log shippers, dashboards, "Docker management UIs") gives that container full host control — and access to every other container's environment and volumes.

**CI build options**
| Option | How | Security | Notes |
|---|---|---|---|
| **Socket mount** (DooD) | job uses the node's Docker daemon | worst: jobs control the node and see other jobs' containers | also broken on containerd-only Kubernetes nodes |
| **Docker-in-Docker** (DinD) | a privileged dockerd sidecar per job | bad: requires {{--privileged}} | isolation between jobs only if one DinD per job |
| **Kaniko** | builds Dockerfiles in userspace inside an unprivileged container | good, no daemon | maintenance status has changed over time (the original Google project was archived in 2025; community forks continue) — verify before adopting |
| **Buildah / Podman** | daemonless builds, rootless with user namespaces | good | needs user namespace support on nodes |
| **BuildKit rootless** (buildkitd in rootless mode, or a remote BuildKit service) | unprivileged BuildKit daemon | good, full BuildKit features (cache mounts, secrets, multi-arch) | needs some seccomp/AppArmor relaxations in rootless mode on some kernels |
| **Managed build services** (cloud build services, Docker Build Cloud, GitHub-hosted runners with ephemeral VMs) | builds in isolated VMs | strong isolation per job | cost; network access to private dependencies |

**Recommended for shared Kubernetes CI**: ephemeral, per-job isolation; **rootless BuildKit** or Buildah in unprivileged pods (or ephemeral VM runners for untrusted code like external PRs); registry-based build cache; secrets via BuildKit secret mounts from short-lived OIDC credentials; no long-lived registry passwords on runners; separate runner pools for trusted (main branch, can push to prod registries) and untrusted (forks, PRs) work.

**Also**: never mount the socket into application containers; replace "needs docker.sock" tools with APIs designed for least privilege (Kubernetes API with RBAC, container runtime metrics via cAdvisor/Prometheus).`,
  code: r`~~~yaml
# GitLab/K8s-style job: rootless BuildKit in an unprivileged pod (no docker.sock, no --privileged)
build-image:
  image:
    name: moby/buildkit:rootless
    entrypoint: [""]
  variables:
    BUILDKITD_FLAGS: --oci-worker-no-process-sandbox
  script:
    - >
      buildctl-daemonless.sh build
      --frontend dockerfile.v0 --local context=. --local dockerfile=.
      --opt platform=linux/amd64,linux/arm64
      --secret id=feed_pat,env=FEED_PAT
      --export-cache type=registry,ref=registry.example/payments-api:buildcache,mode=max
      --import-cache type=registry,ref=registry.example/payments-api:buildcache
      --output type=image,name=registry.example/payments-api:$CI_COMMIT_SHA,push=true
~~~`,
  dia: r`flowchart LR
  subgraph BAD[Avoid]
    J1[CI job] -->|docker.sock| D[Node dockerd = host root]
    J2[CI job] --> DIND[Privileged DinD sidecar]
  end
  subgraph GOOD[Prefer]
    J3[CI job pod - unprivileged] --> BK[Rootless BuildKit / Buildah]
    BK -->|push by digest| REG[(Registry)]
    BK -->|cache| RC[(Registry cache)]
    VM[Untrusted PRs] --> EVM[Ephemeral VM runners]
  end`,
  pts: [r`Access to docker.sock equals root on the host.`, r`Socket mounting and privileged DinD are unsafe for shared CI.`, r`Rootless BuildKit, Buildah or ephemeral VM runners isolate builds.`, r`Registry caches, secret mounts and OIDC credentials for builds.`, r`Separate trusted and untrusted runner pools.`],
  ex: r`A shared Jenkins agent mounted docker.sock; a malicious PR build read other teams' containers' environment variables, including production database credentials. Rootless BuildKit and separate PR runners followed.`,
  fu: [r`How would you build images for untrusted fork PRs safely?`, r`What breaks when moving from DinD to rootless BuildKit?`],
  pit: [r`Mounting docker.sock into CI jobs or apps.`, r`Shared privileged DinD across jobs.`, r`Long-lived registry passwords on runners.`] },

{ id: 'q22', level: 'Senior', tags: ['supply-chain', 'sbom', 'provenance', 'signing'],
  q: r`Produce trustworthy images: SBOMs and provenance attestations with buildx, signing with cosign or Notation, vulnerability scanning policies, reproducible builds, and verification before deployment.`,
  a: r`**What auditors and security teams want to know about any running image**: what is inside it (SBOM), how and where it was built (provenance), who vouches for it (signature), and whether it has known vulnerabilities (scan results + exploitability context).

**SBOM** (Software Bill of Materials): list of packages (OS packages, NuGet, npm) with versions and licences in SPDX or CycloneDX.
- {{docker buildx build --sbom=true}} attaches an SBOM attestation to the image; or generate with Syft/Trivy, or .NET SBOM tooling.
- Use: answer "are we affected by CVE-X / log4shell-style events?" across the fleet in minutes; licence compliance.

**Provenance (SLSA)**: {{--provenance=mode=max}} records the builder, source repository and commit, build arguments and materials as an in-toto attestation. SLSA levels describe increasing guarantees (scripted build → hosted build with provenance → hardened, isolated builders with non-falsifiable provenance).

**Signing**
- **cosign** (Sigstore): keyless signing with the CI workload's OIDC identity (certificate from Fulcio, transparency log entry in Rekor) or KMS-held keys; signatures and attestations stored in the registry next to the image.
- **Notation** (Notary Project): X.509-based signing, popular with Azure (ACR + Key Vault) and enterprise PKI.

**Scanning policy**: scan at build (fail on fixable criticals), at push, and **continuously** in the registry and for running workloads (new CVEs appear after build). Use **VEX** statements to record "not affected" decisions with justification, so teams are not chasing unreachable vulnerabilities. Define SLAs by severity and exposure (internet-facing payment services first).

**Reproducibility**: pin base images by digest, pin package versions, deterministic builds ({{Deterministic=true}}, {{ContinuousIntegrationBuild=true}} in .NET), {{SOURCE_DATE_EPOCH}} for timestamps — so a rebuild produces the same digest or at least a verifiable equivalent.

**Verification before deployment**: admission policies (Kyverno, Sigstore policy-controller, Ratify with Gatekeeper) require a valid signature from the expected CI identity and, optionally, attestations (SBOM present, scan passed, provenance from main branch). Unsigned or wrongly signed images are rejected.`,
  code: r`~~~bash
# Build with SBOM and max provenance attached as attestations
docker buildx build --platform linux/amd64,linux/arm64 \
  --sbom=true --provenance=mode=max \
  -t registry.example/payments-api:$GIT_SHA --push .
DIGEST=$(crane digest registry.example/payments-api:$GIT_SHA)

# Keyless signing with the CI's OIDC identity, then verification as the deploy side would do
cosign sign --yes registry.example/payments-api@$DIGEST
cosign verify registry.example/payments-api@$DIGEST \
  --certificate-identity "https://github.com/bank/payments-api/.github/workflows/build.yml@refs/heads/main" \
  --certificate-oidc-issuer https://token.actions.githubusercontent.com
docker buildx imagetools inspect registry.example/payments-api@$DIGEST --format '{{json .SBOM}}' | jq '.SPDX.packages | length'
~~~
~~~xml
<!-- Directory.Build.props: deterministic .NET builds in CI -->
<PropertyGroup Condition="'$(CI)' == 'true'">
  <Deterministic>true</Deterministic>
  <ContinuousIntegrationBuild>true</ContinuousIntegrationBuild>
</PropertyGroup>
~~~`,
  dia: r`flowchart LR
  SRC[Commit on main] --> B[buildx build: pinned bases, deterministic]
  B --> SB[SBOM attestation]
  B --> PV[SLSA provenance attestation]
  B --> IMG[(Image by digest)]
  IMG --> SG[cosign / Notation signature]
  SCAN[Continuous scanning + VEX] --> IMG
  SG --> ADM[Admission: verify identity + attestations]
  ADM --> RUN[Deploy]`,
  pts: [r`SBOM = what is inside; provenance = how it was built; signature = who vouches.`, r`buildx attaches SBOM and provenance attestations.`, r`cosign keyless with CI identity or Notation with enterprise PKI.`, r`Scan continuously; VEX records non-exploitable findings; SLAs by severity and exposure.`, r`Verify signatures and attestations at admission; aim for reproducible builds.`],
  ex: r`During a critical library CVE, SBOM attestations let a payments firm identify 37 affected images out of 900 in under an hour and prioritise the 5 internet-facing ones.`,
  fu: [r`What SLSA level is realistic for an enterprise CI, and what does it require?`, r`How does VEX reduce vulnerability noise?`],
  pit: [r`Scanning only at build time.`, r`Signatures verified against any identity.`, r`Unpinned base images making builds non-reproducible.`] },

{ id: 'q23', level: 'Senior', tags: ['container-escape', 'kernel', 'sandboxing'],
  q: r`How do container escapes happen? Walk through the main escape classes with examples, and the mitigations including sandboxed runtimes like gVisor, Kata Containers and Firecracker.`,
  a: r`**Escape classes**
1. **Misconfiguration (most common)**: {{--privileged}}, docker.sock mounted, hostPath of {{/}} or {{/proc}}, host PID/network namespaces, dangerous capabilities ({{SYS_ADMIN}}, {{SYS_PTRACE}}, {{DAC_READ_SEARCH}}). Example: with SYS_ADMIN and a writable cgroup v1 hierarchy, the classic {{release_agent}} technique ran commands on the host.
2. **Kernel vulnerabilities**: shared kernel bugs reachable from inside the container — Dirty COW (2016), Dirty Pipe (2022), overlayfs and netfilter bugs. Seccomp reduces reachable syscalls; patching the host kernel is essential.
3. **Runtime vulnerabilities**: bugs in runc/containerd, for example CVE-2019-5736 (overwriting the host runc binary via {{/proc/self/exe}}) and CVE-2024-21626 "Leaky Vessels" (a leaked file descriptor letting a container access the host filesystem via its working directory).
4. **Supply chain**: a malicious image that exploits the above when run, or a compromised build step.
5. **Orchestrator-level paths**: stolen service account tokens or cloud metadata credentials leading to control of the cluster/cloud (not strictly kernel escapes, but the same outcome).

**Mitigations**
- Configuration hygiene: no privileged, no socket mounts, minimal capabilities, read-only rootfs, non-root, seccomp/AppArmor/SELinux, user namespaces/rootless; enforced by policy (admission control, CIS benchmark).
- **Patch** host kernels and runtimes quickly (managed node images, automated node replacement); track runtime CVEs.
- Minimal images reduce tools available post-compromise.
- Runtime detection (Falco/eBPF sensors): unexpected shells, writes to sensitive paths, privilege escalation attempts, outbound connections.
- Separate sensitive workloads onto dedicated nodes; avoid co-locating untrusted code with secrets.

**Sandboxed runtimes** (stronger isolation, plugged in via OCI runtime class)
- **gVisor (runsc)**: a user-space kernel intercepting syscalls — much smaller host kernel attack surface; overhead on syscall-heavy and I/O workloads; some compatibility gaps.
- **Kata Containers**: each container/pod runs inside a lightweight VM with its own kernel — VM-grade isolation with container UX; higher startup and memory overhead.
- **Firecracker** microVMs: minimal VMM used by AWS Lambda and Fargate for multi-tenant isolation.
Use them for untrusted or customer-supplied code, multi-tenant platforms and high-risk processing, not by default for everything.`,
  code: r`~~~yaml
# Kubernetes RuntimeClass: run untrusted document-conversion workloads under gVisor
apiVersion: node.k8s.io/v1
kind: RuntimeClass
metadata: { name: gvisor }
handler: runsc
---
apiVersion: apps/v1
kind: Deployment
metadata: { name: doc-converter, namespace: untrusted }
spec:
  replicas: 3
  selector: { matchLabels: { app: doc-converter } }
  template:
    metadata: { labels: { app: doc-converter } }
    spec:
      runtimeClassName: gvisor
      nodeSelector: { sandbox: "true" }
      containers:
        - name: converter
          image: registry.example/doc-converter@sha256:77ab...
          securityContext: { runAsNonRoot: true, allowPrivilegeEscalation: false, readOnlyRootFilesystem: true, capabilities: { drop: ["ALL"] } }
~~~`,
  dia: r`flowchart TB
  C1[Standard container] -->|syscalls| K[Host kernel - shared attack surface]
  C2[gVisor container] -->|syscalls| SENTRY[gVisor Sentry - user-space kernel] -->|reduced syscalls| K
  C3[Kata container] --> GK[Guest kernel in micro-VM] --> HV[Hypervisor] --> K
  MIS[Misconfig: privileged, docker.sock, hostPath] -.direct escape.-> K`,
  pts: [r`Most escapes come from misconfiguration: privileged, sockets, host mounts, capabilities.`, r`Kernel and runtime CVEs (Dirty Pipe, runc CVE-2019-5736, Leaky Vessels) require fast patching.`, r`Seccomp, capabilities, user namespaces and minimal images shrink the attack surface.`, r`Runtime detection catches post-exploitation behaviour.`, r`gVisor, Kata and Firecracker for untrusted or multi-tenant code.`],
  ex: r`When Leaky Vessels (CVE-2024-21626) was disclosed, a platform team with automated node-image rollouts patched runc across all clusters in two days; teams with hand-built nodes took weeks.`,
  fu: [r`What trade-offs would you measure before adopting gVisor for an API?`, r`How do you patch container runtimes across a fleet quickly?`],
  pit: [r`Assuming default Docker settings make escapes impossible.`, r`Slow kernel and runtime patching.`, r`Running customer-supplied code in standard containers next to sensitive workloads.`] },

{ id: 'q24', level: 'Senior', tags: ['networking-internals', 'veth', 'iptables', 'overlay'],
  q: r`Explain Docker networking internals: veth pairs and bridges, NAT and port publishing with iptables, the embedded DNS server, overlay networks, MTU issues, and why published ports can bypass host firewalls.`,
  a: r`**Bridge networking internals**
- Each container gets its own network namespace with an interface {{eth0}}, which is one end of a **veth pair**; the other end lives in the host namespace attached to a **Linux bridge** ({{docker0}} or {{br-<id>}} for user-defined networks).
- The bridge has an IP (gateway) in the network's subnet ({{172.17.0.0/16}} by default); containers route through it.
- **Outbound**: iptables {{POSTROUTING}} **MASQUERADE** rules NAT container traffic to the host's IP. IP forwarding must be enabled.
- **Inbound (published ports)**: iptables {{DNAT}} rules in the {{DOCKER}} chain (nat table, PREROUTING) rewrite host port → container IP:port; filter rules in {{DOCKER}}/{{DOCKER-USER}} chains allow it. A userland {{docker-proxy}} handles some cases (localhost hairpin).

**Why published ports bypass host firewalls**: DNAT happens in PREROUTING and the forwarded traffic traverses the FORWARD chain — Docker inserts its rules before tools like **UFW/firewalld** rules that apply to INPUT. A UFW "deny 5432" does not stop {{-p 5432:5432}}. Use the {{DOCKER-USER}} chain for your own filtering rules, bind published ports to {{127.0.0.1}} or specific interfaces, or avoid publishing.

**Embedded DNS**: on user-defined networks, containers' {{/etc/resolv.conf}} points to {{127.0.0.11}}, a resolver inside Docker that answers container/service names and forwards others to the host's resolvers. Network aliases give extra names.

**Overlay networks** (Swarm, multi-host): VXLAN encapsulation (UDP 4789) between hosts, with a distributed key-value control plane; optional IPsec encryption. Kubernetes CNIs use similar techniques (VXLAN, Geneve) or routing (BGP, cloud VPC routes) or eBPF.

**MTU problems**: encapsulation adds headers (VXLAN ~50 bytes); if the container MTU is not reduced accordingly (or the underlying network uses a smaller MTU, as in some VPNs and cloud setups), large packets get fragmented or dropped — symptoms: TLS handshakes or large responses hang while small requests work. Set the network/daemon MTU correctly ({{com.docker.network.driver.mtu}}, {{"mtu"}} in daemon.json).

**Address conflicts**: Docker's default 172.17.0.0/16 and subsequent ranges can collide with corporate networks or VPNs — configure {{default-address-pools}} in daemon.json.`,
  code: r`~~~bash
ip link show type veth                              # host-side ends of container veth pairs
bridge link                                         # which veths are attached to which bridge
sudo iptables -t nat -L DOCKER -n --line-numbers    # DNAT rules for published ports
sudo iptables -t nat -L POSTROUTING -n | grep MASQUERADE
# Your own filtering must go in DOCKER-USER, which Docker evaluates first for forwarded traffic
sudo iptables -I DOCKER-USER -i eth0 -p tcp --dport 5432 ! -s 10.20.0.0/16 -j DROP
~~~
~~~json
// /etc/docker/daemon.json: avoid corporate range clashes and set MTU for an encapsulated underlay
{ "default-address-pools": [ { "base": "10.210.0.0/16", "size": 24 } ], "mtu": 1400 }
~~~`,
  dia: r`flowchart LR
  EXT[External client :5432] -->|PREROUTING DNAT| BR[br-payments bridge]
  BR --> V1[veth host end] --> C1[db container eth0 10.210.1.2]
  C2[api container eth0] --> V2[veth] --> BR
  BR -->|POSTROUTING MASQUERADE| OUT[Host NIC to internet]
  UFW[UFW INPUT rules] -.not in path for forwarded traffic.-> BR
  DU[DOCKER-USER chain] -->|filter first| BR`,
  pts: [r`Containers connect via veth pairs to a Linux bridge.`, r`Outbound uses MASQUERADE; published ports use DNAT in the DOCKER chain.`, r`Published ports bypass UFW INPUT rules; filter in DOCKER-USER or bind to 127.0.0.1.`, r`Embedded DNS at 127.0.0.11 on user-defined networks.`, r`Overlay encapsulation needs correct MTU; avoid address pool clashes with corporate networks.`],
  ex: r`Developers on a corporate VPN lost access to internal systems whenever Docker created a network in 172.20.0.0/16, which clashed with an internal range; default-address-pools in the managed daemon.json fixed it.`,
  fu: [r`Why do large TLS responses hang while small requests work across an overlay?`, r`How does Docker's embedded DNS forward external queries?`],
  pit: [r`Relying on UFW to protect published ports.`, r`Default address pools clashing with corporate networks.`, r`Ignoring MTU on encapsulated networks.`] },

{ id: 'q25', level: 'Senior', tags: ['storage-drivers', 'overlay2', 'performance', 'databases'],
  q: r`Storage performance in containers: overlay2 copy-on-write costs, volume versus container-layer I/O, Docker Desktop file-sharing performance, and when (if ever) to run databases in containers.`,
  a: r`**overlay2 behaviour**
- Reads of unchanged files go to the lower (image) layers — fast, and page cache is shared across containers using the same layers.
- The **first write** to a file from a lower layer triggers **copy-up** of the whole file into the container's upper layer. Rewriting a 2 GB file means copying 2 GB first. Many small writes to files in deep directory trees also add overhead.
- Deletes create whiteouts; the container layer grows with every write and is lost when the container is removed.
- Inode and disk usage on {{/var/lib/docker}} can exhaust a host: dangling images, stopped containers, build cache ({{docker system df}}, {{docker system prune}} with care, {{docker builder prune}}).

**Volumes for I/O-heavy paths**: volumes bypass overlayfs — direct host filesystem (or a driver-backed device), predictable performance. Databases, queues, caches with persistence, upload staging and anything write-heavy belong on volumes.

**Docker Desktop (macOS/Windows)**: containers run in a Linux VM; **bind mounts** of host folders cross a file-sharing layer (VirtioFS on macOS, 9P/WSL integration on Windows) — dramatically slower for workloads touching many files ({{node_modules}}, {{bin/obj}}, NuGet caches). Mitigations: keep source inside the WSL 2 filesystem on Windows, use VirtioFS/synchronized file shares on macOS, put caches and build outputs on **named volumes**, use {{docker compose watch}} sync instead of mounting everything.

**Databases in containers**
- **Development and CI**: yes — disposable, version-matched, seeded per run (Testcontainers, Compose).
- **Production on plain Docker hosts**: possible with volumes, but you now own backups, replication, upgrades, monitoring, failover and host failure handling — usually worse than a managed database.
- **Production on Kubernetes**: with mature operators and expertise (see Kubernetes q35).
- Key requirements whichever way: data on durable volumes with tested backups, memory limits that match database settings (buffer pools sized to the container limit, not the host), proper shutdown (long grace periods so the database flushes), and I/O isolation from noisy neighbours.`,
  code: r`~~~bash
docker system df -v                         # images, containers, volumes, build cache usage
docker builder prune --filter until=168h    # remove build cache older than 7 days
# SQL Server in a container for integration tests: data on a volume, memory capped consistently
docker run -d --name sql-test -e ACCEPT_EULA=Y -e MSSQL_SA_PASSWORD="$SA_PASSWORD" \
  -e MSSQL_MEMORY_LIMIT_MB=2048 --memory=3g \
  -v sqltest-data:/var/opt/mssql --stop-timeout 60 \
  mcr.microsoft.com/mssql/server:2022-latest
~~~
~~~yaml
# compose.override.yaml for Docker Desktop: caches and build output on named volumes, not bind mounts
services:
  api:
    volumes:
      - ./src:/src:cached
      - nuget-cache:/root/.nuget/packages
      - api-obj:/src/Payments.Api/obj
volumes: { nuget-cache: {}, api-obj: {} }
~~~`,
  dia: r`flowchart LR
  APP[Container process] -->|first write: copy-up whole file| UP[overlay2 upper layer]
  APP -->|reads| LOW[Image layers - shared page cache]
  APP -->|write-heavy data| VOL[(Named volume - no copy-on-write)]
  MAC[Docker Desktop bind mount] -->|VM file-sharing layer - slow for many files| APP`,
  pts: [r`overlay2 copy-up copies entire files on first write; avoid write-heavy paths in the container layer.`, r`Volumes bypass overlayfs and give predictable I/O.`, r`Docker Desktop bind mounts are slow for many small files; use volumes and WSL 2/VirtioFS.`, r`Databases in containers: great for dev/CI; production needs backups, replication and expertise.`, r`Size database memory to the container limit and give long stop timeouts.`],
  ex: r`A .NET team's local build inside a container took 9 minutes on macOS because bin/obj and NuGet caches lived on bind mounts; moving them to named volumes cut it to 70 seconds.`,
  fu: [r`Why is the page cache shared across containers using the same image?`, r`What goes wrong if a database's buffer pool is sized to host memory inside a container?`],
  pit: [r`Write-heavy workloads in the container layer.`, r`Production databases on plain Docker hosts without backup strategy.`, r`Bind-mounting node_modules or bin/obj on Docker Desktop.`] },

{ id: 'q26', level: 'Senior', tags: ['resource-limits', 'oom', 'cpu', 'dotnet-gc'],
  q: r`Configure resource limits for containers: --memory and --memory-swap, --cpus versus --cpu-shares, PIDs limits, what happens on OOM, and how .NET's GC heap limit and processor count respond to these settings.`,
  a: r`**Memory**
- {{--memory=768m}} sets the cgroup hard limit; exceeding it triggers the kernel **OOM killer** inside the cgroup → the process is killed, exit code **137**, {{OOMKilled: true}} in {{docker inspect}}.
- {{--memory-swap}}: total memory + swap; equal to {{--memory}} disables swap for the container (predictable latency — the common production choice).
- {{--memory-reservation}}: a soft limit used under host pressure.
- Without limits, one container can consume host memory and trigger the host OOM killer against unrelated processes (including dockerd).

**CPU**
- {{--cpus=1.5}}: CFS quota (1.5 CPU-seconds per second across all threads) — a hard cap that causes **throttling** when bursts exceed it.
- {{--cpu-shares}} (cgroup v2: {{cpu.weight}}): relative weight only under contention; no cap when the host is idle.
- {{--cpuset-cpus}}: pin to specific cores (latency-sensitive or licensing cases).

**PIDs**: {{--pids-limit}} prevents fork bombs and runaway thread creation from exhausting host PIDs.

**.NET runtime behaviour**
- Reads cgroup limits at start-up: **GC heap hard limit** defaults to **75% of the memory limit** (configurable via {{DOTNET_GCHeapHardLimit}} or {{DOTNET_GCHeapHardLimitPercent}}). The remaining 25% must cover native memory: thread stacks, JIT code, socket buffers, TLS, native libraries.
- {{Environment.ProcessorCount}} reflects {{--cpus}} (rounded up), affecting Server GC heap count and thread-pool sizing; {{DOTNET_PROCESSOR_COUNT}} overrides.
- When the managed heap nears its limit you get {{OutOfMemoryException}} from the runtime (catchable symptom) rather than an OOM kill; native growth beyond the cgroup limit gives an OOM kill (no managed exception, just exit 137).
- Server GC in a 1-CPU container: few heaps but still tuned for throughput; DATAS (.NET 9 default with Server GC) adapts heap count; Workstation GC can suit tiny containers.

**Sizing approach**: measure working set and GC heap under realistic load (dotnet-counters: {{gc-heap-size}}, {{working-set}}), set memory limit = peak working set + 20-30% headroom, CPU request/limit from p95 usage, load-test with the exact limits used in production.`,
  code: r`~~~bash
docker run -d --name payments --memory=1g --memory-swap=1g --cpus=2 --pids-limit=512 \
  -e DOTNET_GCHeapHardLimitPercent=0x46 \
  registry.example/payments-api:1.4.2              # managed heap capped at 70% of 1 GiB
docker inspect payments --format 'OOMKilled={{.State.OOMKilled}} ExitCode={{.State.ExitCode}}'
docker stats --no-stream payments
~~~
~~~csharp
// Log what the runtime believes its limits are at start-up (helps catch misconfiguration)
var gcInfo = GC.GetGCMemoryInfo();
logger.LogInformation("ProcessorCount={Cpu} TotalAvailableMemoryBytes={Mem} ServerGC={Server}",
    Environment.ProcessorCount, gcInfo.TotalAvailableMemoryBytes, System.Runtime.GCSettings.IsServerGC);
~~~`,
  dia: r`flowchart LR
  LIM[--memory 1g] --> HEAP[GC heap hard limit ~75 percent]
  LIM --> NAT[Native memory: stacks, JIT, buffers ~25 percent]
  HEAP -->|exceeded| OOME[OutOfMemoryException in .NET]
  NAT -->|cgroup limit exceeded| KILL[Kernel OOM kill - exit 137]
  CPUS[--cpus 2] --> PC[ProcessorCount 2: GC heaps, thread pool]
  CPUS -->|burst over quota| THR[CFS throttling]`,
  pts: [r`--memory is a hard cgroup limit: exceeding it means OOM kill, exit 137.`, r`Disable swap for predictable latency; set PIDs limits.`, r`--cpus caps and throttles; shares only weight under contention.`, r`.NET heap limit defaults to 75% of the memory limit; ProcessorCount follows --cpus.`, r`Size from measured working set with headroom and load-test with real limits.`],
  ex: r`A report service was OOM-killed at 1 GiB although its GC heap stayed at 600 MB; native memory from a PDF library pushed the working set over the limit. Raising the limit and capping heap at 60% stabilised it.`,
  fu: [r`How do you tell a managed OutOfMemoryException from a kernel OOM kill?`, r`When would you set DOTNET_PROCESSOR_COUNT explicitly?`],
  pit: [r`No memory limits on shared hosts.`, r`Assuming the GC heap is the whole memory footprint.`, r`Load-testing without the production limits.`] },

{ id: 'q27', level: 'Senior', tags: ['debugging', 'diagnostics', 'dotnet-tools'],
  q: r`Debug a misbehaving containerised .NET service in production: docker logs/inspect/stats/events, exec versus ephemeral debug containers for distroless images, nsenter, and collecting dumps and traces with dotnet-counters, dotnet-trace, dotnet-dump and dotnet-monitor.`,
  a: r`**First-line signals**
- {{docker ps -a}} (restarts, exit codes), {{docker logs --since 10m}} (or {{-f}}), {{docker inspect}} (state, OOMKilled, health, env — careful with secrets, mounts, network), {{docker stats}} (live CPU/memory/IO), {{docker events}} (die/oom/health_status events over time), {{docker top}}.
- Exit codes: 0 clean, 1 app error, 137 SIGKILL (OOM or timeout after SIGTERM), 139 segfault, 143 SIGTERM.

**Getting inside shell-less images**
- {{docker exec}} needs a shell or tool in the image — chiseled/distroless have none (by design).
- **Debug container sharing namespaces**: {{docker run --rm -it --pid=container:payments --network=container:payments <debug-image>}} — a separate image with tools that sees the target's processes and network. {{docker debug}} (Docker Desktop) does this conveniently. Kubernetes: {{kubectl debug --target=...}} ephemeral containers.
- **nsenter** from the host: enter specific namespaces of the container PID (network debugging with host tools).

**.NET diagnostics** (via the diagnostic IPC socket in {{/tmp}} — requires the debug container to share {{/tmp}} or the PID namespace and run as the same UID)
- **dotnet-counters**: live runtime metrics — CPU, GC heap, allocation rate, gen 2 collections, **thread-pool queue length and thread count**, exceptions/sec, monitor lock contention. First stop for latency issues.
- **dotnet-trace**: EventPipe traces (CPU sampling, GC events, custom EventSources) → analyse in PerfView/Visual Studio/speedscope.
- **dotnet-dump**: full or heap dumps for memory leaks and deadlocks; analyse with {{dotnet-dump analyze}} ({{clrstack -all}}, {{dumpheap -stat}}, {{gcroot}}) or Visual Studio.
- **dotnet-gcdump**: lighter heap snapshots for leak analysis.
- **dotnet-monitor**: a sidecar exposing an authenticated HTTP API for metrics, traces, dumps and logs, and **triggers** (collect a dump when CPU > 80% for 1 minute). Ideal for production: no tools in the app image, collection rules decided in advance.

**Production etiquette**: dumps can contain secrets and personal data — treat them as sensitive (encrypted storage, access control, retention); a full dump pauses the process (take it from an instance removed from the load balancer if possible); record actions in the incident timeline.`,
  code: r`~~~bash
docker events --since 30m --filter container=payments --filter event=oom --filter event=die
# Debug container joining the target's PID and network namespaces, with .NET tools installed
docker run --rm -it --pid=container:payments --network=container:payments \
  --user 1654 -v payments-tmp:/tmp registry.example/dotnet-debug:8.0 \
  dotnet-counters monitor -p 1 --counters System.Runtime
docker run --rm -it --pid=container:payments --user 1654 -v payments-tmp:/tmp -v "$PWD/dumps:/dumps" \
  registry.example/dotnet-debug:8.0 dotnet-dump collect -p 1 -o /dumps/payments.dmp
dotnet-dump analyze ./dumps/payments.dmp -c "clrstack -all" -c "dumpheap -stat" -c "exit"
~~~
~~~json
// dotnet-monitor collection rule: dump when CPU stays above 80% for 60 s
{ "CollectionRules": { "HighCpu": {
    "Trigger": { "Type": "EventCounter", "Settings": { "ProviderName": "System.Runtime", "CounterName": "cpu-usage", "GreaterThan": 80, "SlidingWindowDuration": "00:01:00" } },
    "Actions": [ { "Type": "CollectDump", "Settings": { "Type": "Mini", "Egress": "secureBlob" } } ],
    "Limits": { "ActionCount": 1, "ActionCountSlidingWindowDuration": "01:00:00" } } } }
~~~`,
  dia: r`flowchart LR
  APP[payments container - chiseled, no shell] -->|diagnostic socket in /tmp| DBG[Debug container: shared PID ns + /tmp]
  DBG --> CNT[dotnet-counters: thread pool, GC, CPU]
  DBG --> TR[dotnet-trace: CPU sampling]
  DBG --> DMP[dotnet-dump: deadlocks, leaks]
  MON[dotnet-monitor sidecar] -->|triggers| EG[(Secure egress storage)]
  APP --> MON`,
  pts: [r`Start with ps, logs, inspect, stats and events; read exit codes.`, r`Shell-less images: debug containers sharing PID/network namespaces or ephemeral containers.`, r`dotnet-counters first; dotnet-trace for CPU; dotnet-dump/gcdump for hangs and leaks.`, r`dotnet-monitor sidecar with triggers for production collection.`, r`Treat dumps as sensitive data; prefer collecting from drained instances.`],
  ex: r`A settlement worker hung every few days; a dotnet-monitor rule captured a dump on the next hang, and clrstack showed all threads blocked on a synchronous lock around an async call — fixed in one release.`,
  fu: [r`Why must the debug container run as the same UID as the target?`, r`What sensitive data can a full dump contain?`],
  pit: [r`Installing debug tools into production images.`, r`Taking full dumps from instances serving traffic without warning.`, r`Leaving dumps in unsecured storage.`] },

{ id: 'q28', level: 'Senior', tags: ['windows-containers', 'dotnet-framework', 'isolation'],
  q: r`Windows containers for legacy .NET Framework applications: process versus Hyper-V isolation, Server Core versus Nano Server base images, OS version compatibility, image size, orchestration options, and when to port instead.`,
  a: r`**Why they exist**: .NET Framework (4.x) apps, IIS-hosted ASP.NET, WCF services and Windows-specific dependencies cannot run on Linux. Windows containers package them without rewriting.

**Isolation modes**
- **Process isolation**: containers share the host's Windows kernel (like Linux containers). Requires the **container OS version to match the host OS version** (for example a Windows Server 2022 host runs {{ltsc2022}} images).
- **Hyper-V isolation**: each container runs in a lightweight utility VM with its own kernel — stronger isolation and relaxed version matching, at higher start-up and memory cost.

**Base images**
- **Windows Server Core** ({{mcr.microsoft.com/dotnet/framework/aspnet:4.8.1-windowsservercore-ltsc2022}}): full .NET Framework, IIS, most Windows APIs — multi-GB images.
- **Nano Server**: small, but **no .NET Framework** — only modern .NET; useful for .NET (Core) apps that must run on Windows.
- **Windows** (full) image for apps needing even more APIs (GUI components, some COM).

**Practical issues**
- Image sizes of several GB: slow pulls, large registries — pre-pull base layers on nodes, keep base images aligned so layers are shared.
- Patch cadence: monthly Windows updates mean monthly base image rebuilds; host and image versions must be managed together.
- Orchestration: Kubernetes supports Windows node pools (AKS, EKS, GKE) — Linux control plane, Windows workers; some features differ (no privileged containers, different networking/storage support, HostProcess containers for node agents). Windows nodes cost more (licensing included).
- Configuration: web.config transforms → environment-specific config via environment variables (ConfigurationBuilders) or mounted files; IIS logs to stdout via LogMonitor.
- Authentication: Integrated Windows Auth requires gMSA (group Managed Service Accounts) configured for containers.

**Port instead when**: the app is actively developed, has a long future, and its dependencies have modern equivalents — porting to modern .NET on Linux yields smaller images, cheaper nodes, faster scaling and better tooling. Windows containers are a **bridge** (datacentre exit, OS end-of-support) rather than a destination for strategic systems.`,
  code: r`~~~dockerfile
# escape=\x60
# Legacy ASP.NET 4.8 app on Windows Server Core (process isolation needs an ltsc2022 host)
FROM mcr.microsoft.com/dotnet/framework/aspnet:4.8.1-windowsservercore-ltsc2022
WORKDIR /inetpub/wwwroot
COPY ./publish/ .
# Forward IIS logs to stdout so the platform can collect them
ADD https://github.com/microsoft/windows-container-tools/releases/download/v2.1.1/LogMonitor.exe C:/LogMonitor/
COPY LogMonitorConfig.json C:/LogMonitor/
ENTRYPOINT ["C:\\LogMonitor\\LogMonitor.exe", "C:\\ServiceMonitor.exe", "w3svc"]
~~~
~~~yaml
# Kubernetes: schedule onto Windows nodes of the matching OS build
spec:
  nodeSelector:
    kubernetes.io/os: windows
    node.kubernetes.io/windows-build: "10.0.20348"     # Windows Server 2022
~~~`,
  dia: r`flowchart TB
  subgraph PI[Process isolation]
    HK[Host Windows Server 2022 kernel] --> C1[ltsc2022 container]
  end
  subgraph HV[Hyper-V isolation]
    UVM[Utility VM with its own kernel] --> C2[Container - version flexible]
  end
  LEG[.NET Framework 4.8 app] --> SC[Server Core base - multi-GB]
  NEW[Modern .NET app] --> NANO[Nano Server or Linux images]`,
  pts: [r`Windows containers package .NET Framework, IIS and WCF apps without rewrites.`, r`Process isolation needs matching host and image OS versions; Hyper-V isolation relaxes it.`, r`Server Core for .NET Framework; Nano Server only for modern .NET.`, r`Large images, monthly patch rebuilds, Windows node pools and gMSA for Windows auth.`, r`Treat Windows containers as a bridge; port strategic apps to modern .NET on Linux.`],
  ex: r`An insurer containerised 40 .NET Framework apps on AKS Windows node pools to exit a datacentre in six months, then ported the five most actively developed apps to .NET 8 on Linux over the next year.`,
  fu: [r`How does Integrated Windows Authentication work from a container?`, r`Why must Windows base images be rebuilt monthly?`],
  pit: [r`Mismatched host and container OS versions with process isolation.`, r`Expecting Nano Server to run .NET Framework.`, r`Treating Windows containers as the long-term target for strategic apps.`] },

{ id: 'q29', level: 'Senior', tags: ['ci', 'image-pipeline', 'caching', 'promotion'],
  q: r`Design the container image pipeline in CI/CD: build caching on ephemeral runners, testing inside or outside the image build, tagging and promotion, scanning gates, and multi-service monorepo builds.`,
  a: r`**Principles**: build once, test the artefact you ship, promote the same digest, make builds fast and reproducible, and fail early on quality and security gates.

**Pipeline stages**
1. **Lint**: Dockerfile linting (hadolint), IaC/policy checks.
2. **Build**: BuildKit/buildx with a **remote cache** ({{type=registry}} or {{type=gha}}, {{mode=max}}); cache mounts for NuGet/npm; secrets via secret mounts and short-lived tokens.
3. **Test**: unit tests either in a {{test}} stage of the Dockerfile or in the CI job before building the runtime image (faster feedback, test reports easier to collect); **integration tests against the built image** (start it with dependencies via Testcontainers/Compose and run API tests) — this tests the real artefact including config and entrypoint.
4. **Scan and attest**: vulnerability scan (fail on fixable criticals per policy), SBOM and provenance attestations, sign with the CI identity.
5. **Push** with SHA tag; record the **digest** as the pipeline output.
6. **Promote**: update GitOps manifests for dev; promotion to staging/prod is a reviewed change to the digest (or registry-to-registry copy) — no rebuilds.

**Monorepo with many services**
- Build only what changed: path-based triggers or dependency-graph tools (Nx, Bazel, dotnet affected tooling) so a change to {{Payments.Domain}} rebuilds its consumers only.
- Shared base images and shared build stages to maximise cache reuse.
- Parallel builds per service; a matrix of platforms (amd64/arm64) on native runners.

**Speed targets**: incremental image build under 2-3 minutes, full pipeline under ~15 minutes; track build time and cache hit rate as metrics.

**Reproducibility and traceability**: pinned base image digests (with automated update PRs from Renovate/Dependabot), OCI labels with source and revision, deterministic .NET builds, artefact retention for audit.`,
  code: r`~~~yaml
# GitHub Actions (excerpt): build once with cache, test the image, scan, sign, output digest
jobs:
  image:
    runs-on: ubuntu-latest
    permissions: { contents: read, packages: write, id-token: write }
    outputs: { digest: "$\{{ steps.build.outputs.digest }}" }
    steps:
      - uses: actions/checkout@v4
      - uses: docker/setup-buildx-action@v3
      - id: build
        uses: docker/build-push-action@v6
        with:
          push: true
          tags: registry.example/payments-api:$\{{ github.sha }}
          cache-from: type=gha
          cache-to: type=gha,mode=max
          sbom: true
          provenance: mode=max
      - run: dotnet test tests/Payments.Api.IntegrationTests -e IMAGE=registry.example/payments-api@$\{{ steps.build.outputs.digest }}
      - run: trivy image --exit-code 1 --severity CRITICAL --ignore-unfixed registry.example/payments-api@$\{{ steps.build.outputs.digest }}
      - run: cosign sign --yes registry.example/payments-api@$\{{ steps.build.outputs.digest }}
~~~`,
  dia: r`flowchart LR
  PR[Merge] --> LINT[hadolint + policy]
  LINT --> BUILD[buildx + remote cache]
  BUILD --> IT[Integration tests against the built image]
  IT --> SCAN[Scan + SBOM + provenance + sign]
  SCAN --> PUSH[(Registry: SHA tag, digest output)]
  PUSH --> DEV[GitOps dev: digest]
  DEV -->|reviewed promotion, same digest| PROD[GitOps prod]`,
  pts: [r`Build once, test the shipped artefact, promote the same digest.`, r`Remote caches and cache mounts make ephemeral runners fast.`, r`Integration tests against the built image catch config and entrypoint bugs.`, r`Scan, attest and sign as gates before push and promotion.`, r`Monorepos build only affected services; track build time and cache hit rate.`],
  ex: r`Integration-testing the built image caught a release where the .NET 8 port change broke the container while unit tests passed; the pipeline failed before anything reached staging.`,
  fu: [r`Where should unit tests run: in the Dockerfile or in CI directly?`, r`How do you keep base image digests current automatically?`],
  pit: [r`Rebuilding images per environment.`, r`Testing source code but never the built image.`, r`No remote cache on ephemeral runners.`] },

{ id: 'q30', level: 'Senior', tags: ['testcontainers', 'integration-testing', 'dotnet'],
  q: r`Use Testcontainers for .NET integration tests: how it works, fixtures and lifetime, real databases versus in-memory fakes, parallelism, CI requirements, and testing message brokers and the application image itself.`,
  a: r`**What it is**: a library that starts real dependencies (PostgreSQL, SQL Server, Redis, Kafka, RabbitMQ, LocalStack, Azurite) in throwaway containers from test code, waits until they are ready, exposes connection details, and cleans up (via the Ryuk reaper container) even if tests crash.

**Why real dependencies**: EF Core's in-memory provider and SQLite differ from SQL Server/PostgreSQL in transactions, constraints, collation, SQL translation, concurrency tokens and locking — tests pass while production fails. A real engine in a container catches migration errors, constraint violations, isolation behaviour and provider-specific SQL.

**Lifetime and speed**
- Start containers **once per test class or collection** ({{IAsyncLifetime}} with xUnit class/collection fixtures), not per test.
- Reset state between tests: transactions rolled back, Respawn to delete data, or per-test databases/schemas.
- Apply migrations once at fixture start (tests also validate migrations).
- Reuse/parallelism: separate containers per parallel collection, or one shared container with isolated databases; avoid fixed host ports (Testcontainers maps random ports).
- Pre-pull images in CI; pin image versions to production versions.

**Testing the full application**: build the image (or use {{WebApplicationFactory}} in-process with Testcontainers dependencies); for container-level tests, start the **built app image** with its dependencies on a Testcontainers network and call its HTTP API — validates entrypoint, ports, config and health checks.

**Message brokers**: Kafka/RabbitMQ containers to test producers/consumers, serialization, retries, DLQ behaviour and idempotency end to end.

**CI requirements**: a Docker-compatible runtime available to the test process (Docker on the runner, a remote Docker host, Testcontainers Cloud, or Podman). On Kubernetes runners without Docker, use a remote daemon or a cloud runtime — avoid privileged DinD.`,
  code: r`~~~csharp
public sealed class PaymentsDbFixture : IAsyncLifetime
{
    private readonly PostgreSqlContainer _pg = new PostgreSqlBuilder()
        .WithImage("postgres:16.4")              // same major version as production
        .Build();
    public string ConnectionString => _pg.GetConnectionString();

    public async Task InitializeAsync()
    {
        await _pg.StartAsync();
        await using var db = new PaymentsDbContext(new DbContextOptionsBuilder<PaymentsDbContext>()
            .UseNpgsql(ConnectionString).Options);
        await db.Database.MigrateAsync();        // validates migrations too
    }
    public Task DisposeAsync() => _pg.DisposeAsync().AsTask();
}

public sealed class IdempotencyTests(PaymentsDbFixture fx) : IClassFixture<PaymentsDbFixture>
{
    [Fact]
    public async Task Same_idempotency_key_creates_one_payment()
    {
        var repo = new PaymentRepository(fx.ConnectionString);
        var first = await repo.CreateAsync("m-1", "key-123", 10_00);
        var second = await repo.CreateAsync("m-1", "key-123", 10_00);   // unique constraint path
        Assert.Equal(first.PaymentId, second.PaymentId);
    }
}
~~~`,
  dia: r`flowchart LR
  T[xUnit test collection] --> FX[Fixture: start once]
  FX --> PG[(postgres:16.4 container - random port)]
  FX --> KF[(Kafka container)]
  FX --> APPIMG[Built app image container]
  T -->|HTTP| APPIMG
  APPIMG --> PG
  RYUK[Ryuk reaper] -.cleanup.-> PG`,
  pts: [r`Testcontainers runs real dependencies in disposable containers from test code.`, r`In-memory fakes hide provider differences; real engines catch migration and constraint bugs.`, r`Start once per class/collection; reset state between tests; random ports.`, r`Test the built image and message brokers end to end.`, r`CI needs a Docker-compatible runtime; avoid privileged DinD.`],
  ex: r`Tests on EF Core's in-memory provider passed while production failed on a unique index with a case-insensitive collation; moving to Testcontainers with SQL Server reproduced it immediately.`,
  fu: [r`How do you keep a large Testcontainers suite under 10 minutes?`, r`How would you run Testcontainers on Kubernetes-based CI runners?`],
  pit: [r`Using EF Core in-memory as a database substitute.`, r`Starting a container per test.`, r`Fixed host ports causing parallel test collisions.`] },

{ id: 'q31', level: 'Senior', tags: ['incident', 'oom', 'exit-137', 'memory-leak'],
  q: r`Incident: a containerised .NET order service restarts every few hours with exit code 137. How do you determine whether it is an OOM kill, a failed graceful shutdown, or a leak, and how do you fix it?`,
  a: r`**Exit 137 = SIGKILL** (128 + 9). Three common causes:
1. **Kernel OOM kill** (memory limit exceeded): {{docker inspect --format '{{.State.OOMKilled}}'}} → true; {{docker events}} shows {{oom}}; Kubernetes shows {{Reason: OOMKilled}}; host {{dmesg}} shows the OOM killer.
2. **Killed after the stop timeout**: the container received SIGTERM (deploy, scale-in, node drain) and did not exit in time → SIGKILL. Correlates with deployments/drains; OOMKilled false.
3. **External kill** (manual, health-check-driven restarts by an orchestrator, liveness failure → kubelet kill).

**If OOM: leak or under-sizing?**
- Plot memory (working set) over time: **sawtooth growing steadily until the limit** → leak; **flat with spikes at certain operations** → under-sized for peak (large payload processing, batch jobs).
- Compare **GC heap size** (dotnet-counters {{gc-heap-size}}) with working set: heap growing → managed leak; heap stable but working set growing → **native** leak or native buffers (compression, image/PDF libraries, unmanaged memory, many threads).
- Managed leak tools: {{dotnet-gcdump}} at two points in time and diff (types growing), {{dotnet-dump}} with {{dumpheap -stat}} and {{gcroot}} to find what holds objects.

**Typical .NET leak causes**
- Static or singleton caches without eviction ({{ConcurrentDictionary}} keyed by request data).
- Event handler subscriptions never removed; captured lambdas.
- {{HttpClient}}/{{DbContext}} created and never disposed; long-lived {{DbContext}} tracking thousands of entities.
- {{IMemoryCache}} without size limits; logging scopes holding large objects.
- Native: undisposed {{Stream}}s, bitmaps, compression contexts.

**Fixes**: bound caches (size limits, expirations), dispose correctly, scope DbContexts per unit of work, stream large payloads instead of buffering, set memory limits from measured peaks with headroom, configure the GC heap limit to leave native headroom. For the stop-timeout case: exec-form entrypoint, shorter shutdown work, longer grace period.

**Prevention**: memory alerts at 80% of the limit with trend detection, soak tests (hours of realistic load) in CI/staging, dotnet-monitor triggers to collect gcdumps when memory crosses thresholds.`,
  code: r`~~~bash
docker inspect orders --format 'OOMKilled={{.State.OOMKilled}} ExitCode={{.State.ExitCode}} Restarts={{.RestartCount}}'
docker events --since 6h --filter container=orders --filter event=oom
# Managed heap snapshots 30 minutes apart, then compare type counts
dotnet-gcdump collect -p 1 -o /dumps/orders-1.gcdump && sleep 1800 && dotnet-gcdump collect -p 1 -o /dumps/orders-2.gcdump
dotnet-gcdump report /dumps/orders-2.gcdump | head -30
~~~
~~~csharp
// Leak found: unbounded static cache keyed by customer id
private static readonly ConcurrentDictionary<string, CustomerProfile> Cache = new();   // grows forever

// Fix: bounded cache with expiry and size accounting
builder.Services.AddMemoryCache(o => o.SizeLimit = 50_000);
_cache.Set(customerId, profile, new MemoryCacheEntryOptions { Size = 1, SlidingExpiration = TimeSpan.FromMinutes(10) });
~~~`,
  dia: r`flowchart TD
  E[Exit 137] --> Q{OOMKilled true?}
  Q -->|no| T[SIGKILL after stop timeout or external kill: check deploys, drains, liveness]
  Q -->|yes| M{Memory trend}
  M -->|steady growth| H{GC heap growing?}
  M -->|spikes on operations| S[Under-sized: raise limit or stream payloads]
  H -->|yes| ML[Managed leak: gcdump diff, gcroot]
  H -->|no| NL[Native leak or buffers: undisposed streams, native libs]`,
  pts: [r`Exit 137 is SIGKILL: OOM, stop-timeout, or external kill.`, r`Check OOMKilled, events and correlation with deploys.`, r`Growing heap means managed leak; growing working set with stable heap means native memory.`, r`gcdump diffs and gcroot find leak roots.`, r`Bound caches, dispose correctly, stream payloads, size limits from measurements, soak tests.`],
  ex: r`An order service leaked through a static dictionary of customer profiles; gcdump diffs showed 2 million entries after 6 hours. A bounded IMemoryCache fixed the restarts.`,
  fu: [r`How do you collect evidence when the container dies before you can attach tools?`, r`Why can a stable GC heap still lead to OOM kills?`],
  pit: [r`Raising the memory limit without finding the leak.`, r`Assuming every 137 is an OOM.`, r`Unbounded static caches.`] },

{ id: 'q32', level: 'Senior', tags: ['incident', 'build-performance', 'cache'],
  q: r`Incident: image builds in CI suddenly take 15+ minutes instead of 3, and image size doubled. Investigate and fix systematically.`,
  a: r`**Investigate**
1. **Compare build logs** ({{--progress=plain}}) between a fast and a slow build: which steps are no longer {{CACHED}}? The first uncached step points at the cause.
2. **Context size**: "transferring context: 1.2GB" means the {{.dockerignore}} is missing entries (new folders like test outputs, {{node_modules}}, {{artifacts/}}, {{.git}} after a CI change).
3. **Dockerfile changes**: a reordered {{COPY . .}} before restore; a new {{ARG}} early in the file whose value changes every build (for example {{BUILD_NUMBER}} used before the restore step invalidates everything after it); a moved {{RUN apt-get}}.
4. **Cache backend**: the remote cache stopped working (expired registry credentials, cache ref changed, {{mode=min}} instead of {{max}}, cache size limits on the GitHub Actions cache evicting entries, new runner image without the cache configuration).
5. **Base image churn**: the base tag points to a new digest daily (floating tags) → everything rebuilds; also explains size changes.
6. **Size doubling**: {{docker history}} / dive shows which layer grew — common causes: SDK image used as final stage after a refactor, self-contained publish on top of a runtime image (runtime twice), debug symbols, test projects published, files copied then deleted in later layers, a new native dependency.

**Fixes**
- Restore the layer order: manifests → restore (cache mount) → source → publish.
- Move volatile {{ARG}}s (build number, commit SHA) to the **last stage, last lines** (labels) so they invalidate nothing important.
- Fix .dockerignore; repair the remote cache with {{mode=max}} and verify hits.
- Pin base images by digest with automated update PRs (controlled, batched rebuilds).
- Final stage from runtime/chiseled image, framework-dependent publish, exclude tests and PDBs.

**Guard rails**: CI metrics for build duration, cache hit ratio and image size with alerts/budgets; a hadolint rule set; image size check in the pipeline (fail if > budget); dive's CI mode to detect wasted space.`,
  code: r`~~~dockerfile
# Before (slow): a per-build ARG declared and used early invalidates every later layer
ARG BUILD_NUMBER
RUN echo $BUILD_NUMBER > /build.txt
COPY . .
RUN dotnet restore && dotnet publish -c Release -o /out

# After (fast): stable layers first, volatile metadata last
COPY *.sln Directory.Packages.props ./
COPY src/Orders.Api/*.csproj src/Orders.Api/
RUN --mount=type=cache,id=nuget,target=/root/.nuget/packages dotnet restore
COPY src/ src/
RUN --mount=type=cache,id=nuget,target=/root/.nuget/packages dotnet publish src/Orders.Api -c Release --no-restore -o /out
# ...final stage...
ARG BUILD_NUMBER
LABEL org.opencontainers.image.version=$BUILD_NUMBER
~~~
~~~bash
docker buildx build --progress=plain . 2>&1 | grep -E '^#[0-9]+ (CACHED|\[)' | head -40   # which steps miss cache
dive --ci --lowestEfficiency=0.95 registry.example/orders-api:$GIT_SHA                   # wasted space check
~~~`,
  dia: r`flowchart TD
  SLOW[Build 15 min, image 2x] --> L[Compare plain logs: first uncached step]
  L --> CTX{Context huge?}
  CTX -->|yes| DI[Fix .dockerignore]
  L --> ORD{Volatile ARG or COPY early?}
  ORD -->|yes| RE[Reorder: stable first, volatile last]
  L --> RC{Remote cache hits?}
  RC -->|no| FIX[Repair cache creds, mode=max]
  SLOW --> SZ[docker history / dive: which layer grew]
  SZ --> FS[Final stage, framework-dependent, no tests/PDBs]`,
  pts: [r`Find the first uncached step in plain build logs.`, r`Check context size and .dockerignore.`, r`Volatile ARGs and early COPY invalidate later layers; move them last.`, r`Verify the remote cache works; pin base digests with controlled updates.`, r`Use history/dive to find size growth; guard with budgets and metrics.`],
  ex: r`A team added ARG GIT_SHA at the top of the Dockerfile for a label; every build missed the cache from line 3 onward. Moving it to the final stage restored 3-minute builds.`,
  fu: [r`How do floating base tags affect both cache and security?`, r`What does mode=max change in remote caching?`],
  pit: [r`Volatile build args early in the Dockerfile.`, r`Missing .dockerignore entries after repo changes.`, r`No size or duration budgets in CI.`] },

{ id: 'q33', level: 'Senior', tags: ['incident', 'works-locally', 'architecture', 'globalization'],
  q: r`Incident: a service "works on my machine" in Docker Desktop but fails in production containers. List the usual culprits — CPU architecture, globalization and time zones, certificates, file paths and case sensitivity, DNS, permissions, resource limits — and how you find which one it is.`,
  a: r`**Usual culprits and their signatures**
| Culprit | Typical symptom | Check |
|---|---|---|
| **Architecture mismatch** (built on Apple Silicon arm64, prod amd64, or vice versa) | {{exec format error}}, native library load failures | {{docker image inspect --format '{{.Architecture}}'}}; build multi-arch (q17) |
| **Globalization/ICU** (invariant mode in chiseled/Alpine) | wrong currency symbols, culture exceptions, sorting differences | check {{DOTNET_SYSTEM_GLOBALIZATION_INVARIANT}}, use chiseled-extra (q9) |
| **Time zones** (no tzdata) | {{TimeZoneNotFoundException}}, wrong cut-off times | tzdata in image; use IANA IDs ({{Europe/London}}), not Windows IDs |
| **Certificates** (corporate CA, internal TLS) | {{The remote certificate is invalid}} only in prod network | install CA bundle in image; test against prod-like endpoints |
| **Case-sensitive paths** (Windows/macOS dev, Linux prod) | {{FileNotFoundException}} for {{Templates/Invoice.html}} vs {{templates/invoice.html}} | consistent casing; tests on Linux |
| **Permissions** (non-root UID 1654, read-only rootfs) | {{UnauthorizedAccessException}} writing to {{/app/logs}} or temp | write to {{/tmp}} or volumes; chown at build |
| **Ports** (8080 default in .NET 8+) | connection refused from Service/LB | ASPNETCORE_HTTP_PORTS vs targetPort |
| **DNS and networking** (ndots, corporate DNS, proxies, MTU) | timeouts to external hosts, 5 s spikes | dig from a debug container; proxy env vars |
| **Resource limits** (dev has no limits) | OOM kills, throttling, thread-pool starvation under load | run locally with production limits |
| **Configuration and secrets** (dev uses user-secrets/.env) | null config values, auth failures | log config sources (not values) at start-up; validate options on start ({{ValidateOnStart}}) |
| **Environment** ({{ASPNETCORE_ENVIRONMENT}} differs) | dev-only middleware, different config files | explicit environment in deployment |

**Method**: reproduce with the **exact production image digest** locally ({{docker run --platform linux/amd64 --memory ... --read-only --user 1654}}), same environment variables and config, then diff behaviour. Add start-up self-checks (culture data, time zone, required config, writable temp) that fail fast with clear messages. Keep a "production-like" compose profile for developers.`,
  code: r`~~~bash
# Reproduce production conditions locally with the exact image digest
docker run --rm -it --platform linux/amd64 --memory=768m --cpus=1 --read-only --tmpfs /tmp \
  --user 1654 -e ASPNETCORE_ENVIRONMENT=Production --env-file ./prod-like.env \
  -p 8080:8080 registry.example/orders-api@sha256:9c1e...
docker image inspect registry.example/orders-api@sha256:9c1e... --format '{{.Os}}/{{.Architecture}}'
~~~
~~~csharp
// Fail fast at start-up with clear messages instead of mysterious runtime errors
builder.Services.AddOptions<PspOptions>().BindConfiguration("Psp").ValidateDataAnnotations().ValidateOnStart();
var tz = TimeZoneInfo.FindSystemTimeZoneById("Europe/London");                 // requires tzdata
if (CultureInfo.GetCultureInfo("en-GB").NumberFormat.CurrencySymbol != "£")
    throw new InvalidOperationException("Culture data missing (invariant globalization)");
File.WriteAllText(Path.Combine(Path.GetTempPath(), ".write-check"), "ok");    // temp is writable
~~~`,
  dia: r`flowchart TD
  F[Works locally, fails in prod] --> R[Reproduce with exact prod digest + limits + user + env]
  R --> A[Architecture: exec format error?]
  R --> G[Globalization / tzdata?]
  R --> C[Certificates / CA?]
  R --> P[Paths case, permissions, read-only FS?]
  R --> N[Ports, DNS, proxies?]
  R --> L[Limits: OOM, throttling?]
  R --> CF[Config / environment differences?]`,
  pts: [r`Architecture, globalization, tzdata and CAs are the classic image differences.`, r`Linux paths are case-sensitive; non-root and read-only rootfs change write permissions.`, r`.NET 8 port 8080, DNS and proxy settings differ by environment.`, r`Reproduce with the exact digest, platform, limits, user and environment.`, r`Add start-up self-checks and ValidateOnStart for configuration.`],
  ex: r`An invoice service failed only in production because templates were referenced as "Templates/Invoice.html" while the folder was "templates"; Windows dev machines ignored case. A Linux CI integration test now catches it.`,
  fu: [r`How do you make developer environments production-like without slowing them down?`, r`Why prefer IANA time zone IDs in containers?`],
  pit: [r`Testing only on macOS/Windows file systems.`, r`Running locally without limits or as root.`, r`Building arm64 images on laptops and shipping them to amd64 servers.`] },

{ id: 'q34', level: 'Senior', tags: ['docker-desktop', 'licensing', 'podman', 'developer-tooling'],
  q: r`Docker Desktop licensing and alternatives for an enterprise: who needs a paid subscription, the alternatives (Podman Desktop, Rancher Desktop, Colima, WSL 2 with Docker Engine), and the operational and security considerations of standardising developer container tooling.`,
  a: r`**Licensing facts**: Docker Desktop is free for personal use, education, non-commercial open source, and **small businesses (fewer than 250 employees and less than $10 million annual revenue)**. Larger organisations need a paid subscription (Pro, Team or Business). Docker Engine (the open-source daemon on Linux) and the CLI remain free. Check current terms — they have changed before.

**What Docker Desktop provides**: a managed Linux VM on macOS/Windows, file sharing, networking, Kubernetes, Compose, extensions, BuildKit/buildx, credential helpers; Business tier adds **admin controls**: Settings Management (lock settings), Registry Access Management (allowed registries), Image Access Management, SSO and enhanced container isolation.

**Alternatives**
| Tool | Notes |
|---|---|
| **Podman Desktop** | daemonless, rootless-first, Docker-compatible CLI/API socket, Compose support via podman-compose or docker-compose against the Podman socket; Kubernetes YAML generation |
| **Rancher Desktop** | containerd (nerdctl) or dockerd (moby) engine, bundled k3s Kubernetes; free |
| **Colima** (macOS/Linux) | lightweight VM running Docker or containerd; CLI-driven |
| **WSL 2 + Docker Engine** (Windows) | Docker Engine installed inside a WSL distro; no Desktop; manual setup |
| **Cloud dev environments** (Codespaces, Dev Box, devcontainers on remote hosts) | containers run remotely; laptops thin |

**Enterprise considerations**
- **Compatibility**: Testcontainers, devcontainers, Compose files, IDE integrations and corporate proxies must work with the chosen tool; pilot with real projects.
- **Security**: control which registries developers can pull from (supply chain), proxy/CA configuration, rootless defaults, keeping the tool patched (it runs a VM with privileged components), no exposed daemon ports.
- **Support and fleet management**: MDM deployment, settings enforcement, upgrade cadence, helpdesk knowledge.
- **Cost comparison**: subscription cost vs engineering time spent on DIY setups and support.
- **Architecture**: Apple Silicon laptops build arm64 by default — CI must build production architectures (q17).

**A sensible enterprise stance**: pick one supported option per OS (paid Docker Desktop Business for its management features, or Podman/Rancher Desktop with internal support), publish golden configuration (proxies, CA, registry mirror), and keep project tooling engine-agnostic (Compose spec, devcontainers, Testcontainers).`,
  code: r`~~~json
// Docker Desktop Business: admin-settings.json (locked settings pushed via MDM)
{
  "configurationFileVersion": 2,
  "exposeDockerAPIOnTCP2375": { "locked": true, "value": false },
  "enhancedContainerIsolation": { "locked": true, "value": true },
  "proxy": { "locked": true, "mode": "manual", "http": "http://proxy.bank.example:8080", "https": "http://proxy.bank.example:8080", "exclude": "localhost,*.bank.example" },
  "analyticsEnabled": { "locked": true, "value": false }
}
~~~
~~~bash
# Podman as a drop-in for Compose and Testcontainers
podman machine init --cpus 4 --memory 8192 && podman machine start
export DOCKER_HOST="unix://$(podman machine inspect --format '{{.ConnectionInfo.PodmanSocket.Path}}')"
export TESTCONTAINERS_RYUK_DISABLED=false
docker compose up -d        # docker CLI talking to the Podman socket
~~~`,
  dia: r`flowchart LR
  DEV[Developer laptop] --> CH{Standard tool}
  CH -->|managed, paid| DD[Docker Desktop Business: settings mgmt, registry access]
  CH -->|free| PD[Podman Desktop - rootless]
  CH -->|free| RD[Rancher Desktop - containerd/k3s]
  DD --> MIR[(Internal registry mirror + CA + proxy config)]
  PD --> MIR
  RD --> MIR
  PROJ[Projects: Compose spec, devcontainers, Testcontainers - engine-agnostic] --> CH`,
  pts: [r`Docker Desktop is paid for organisations with 250+ employees or $10M+ revenue; Engine and CLI stay free.`, r`Alternatives: Podman Desktop, Rancher Desktop, Colima, WSL 2 Engine, cloud dev environments.`, r`Validate compatibility with Testcontainers, devcontainers, Compose and proxies.`, r`Enforce settings, registry access and patching centrally.`, r`Keep project tooling engine-agnostic.`],
  ex: r`A bank ran a two-week pilot of Podman Desktop with 30 developers; Testcontainers and Compose worked after socket configuration, but a few IDE integrations did not, so it chose Docker Desktop Business for its locked settings and registry controls.`,
  fu: [r`What does Enhanced Container Isolation protect against on developer machines?`, r`How do you restrict which registries developers can pull from?`],
  pit: [r`Ignoring licence terms in large organisations.`, r`Exposing the Docker daemon on TCP 2375 without TLS.`, r`Tool choices that break Testcontainers or devcontainers.`] },

{ id: 'q35', level: 'Senior', tags: ['compose-production', 'swarm', 'single-host', 'orchestration'],
  q: r`Is Docker Compose acceptable in production? Compare single-host Compose, Docker Swarm, Kubernetes and managed container services, and describe what a responsible single-host deployment needs.`,
  a: r`**Compose in production** is legitimate for **small, non-critical, single-host** systems: internal tools, low-traffic sites, edge/branch appliances, on-premises vendor deployments. Limits: **one host = one failure domain** (no failover), no rolling updates across hosts, scaling bounded by one machine, no built-in secrets management beyond files, limited health-based self-healing (restart policies on exit only).

**Options compared**
| Option | Fits | Trade-offs |
|---|---|---|
| **Compose on one host** | small internal apps, edge, demos | no HA; manual operations; simple |
| **Docker Swarm** | small clusters wanting Compose-like syntax with multi-host, rolling updates, secrets | much smaller ecosystem and momentum than Kubernetes; still maintained (Mirantis), but few new adopters |
| **Kubernetes (managed)** | many services/teams, HA, ecosystem | operational complexity (see Kubernetes q40) |
| **Managed container services** (ECS Fargate, Container Apps, Cloud Run, App Service for containers) | most business apps without Kubernetes needs | provider lock-in; platform limits |

**For a payments or customer-facing system**: not single-host Compose — use a managed container service or Kubernetes with multiple AZs.

**A responsible single-host Compose deployment**
- Restart policies ({{restart: unless-stopped}}), health checks, resource limits per service.
- Pinned image digests, controlled updates ({{docker compose pull}} + {{up -d}} in a maintenance window, or Watchtower-like tools only with care).
- Secrets as files with restricted permissions (or fetched from a vault at start), not in compose files or env.
- Reverse proxy with TLS (Caddy/Traefik/NGINX) and only it exposed; databases not published.
- **Backups** of volumes off-host, tested restores; host monitoring and log shipping; log rotation.
- Host hardening: patched OS, firewall (remember Docker bypasses UFW — use DOCKER-USER), no exposed Docker API, rootless or userns-remap where possible.
- Infrastructure as code for the host (cloud-init/Ansible) so it can be rebuilt; documented recovery time.

**Interview framing**: choose the simplest platform that meets availability, scale and team needs — and be explicit about the failure modes you accept.`,
  code: r`~~~yaml
# compose.prod.yaml for a small internal reporting tool on one host
services:
  proxy:
    image: caddy:2.8@sha256:6a1d...
    ports: [ "443:443" ]
    volumes: [ "./Caddyfile:/etc/caddy/Caddyfile:ro", "caddy-data:/data" ]
    restart: unless-stopped
  app:
    image: registry.example/reporting@sha256:c41b...
    environment: { ASPNETCORE_ENVIRONMENT: Production, ConnectionStrings__Db__File: /run/secrets/db_conn }
    secrets: [db_conn]
    read_only: true
    tmpfs: [ /tmp ]
    deploy: { resources: { limits: { cpus: "2", memory: 1g } } }
    healthcheck: { test: ["CMD", "dotnet", "Reporting.dll", "--healthcheck"], interval: 30s, retries: 3 }
    restart: unless-stopped
  db:
    image: postgres:16.4@sha256:1b2c...
    volumes: [ "pgdata:/var/lib/postgresql/data" ]
    restart: unless-stopped                           # not published; backups via nightly pg_dump to object storage
secrets: { db_conn: { file: /etc/reporting/secrets/db_conn } }
volumes: { pgdata: {}, caddy-data: {} }
~~~`,
  dia: r`flowchart TD
  Q[Production container platform?] --> C{Critical, customer-facing, HA needed?}
  C -->|no, small single host| CMP[Compose + hardening + backups]
  C -->|yes| K{Need Kubernetes ecosystem?}
  K -->|no| MCS[Managed container service multi-AZ]
  K -->|yes| MK[Managed Kubernetes]
  SW[Docker Swarm] -.small multi-host, low ecosystem momentum.-> C`,
  pts: [r`Compose is fine for small, non-critical single-host systems.`, r`One host is one failure domain; no HA or cross-host rolling updates.`, r`Swarm adds multi-host but has limited momentum; managed services or Kubernetes for critical systems.`, r`Single-host needs pinned digests, secrets files, TLS proxy, backups, monitoring, hardening, IaC.`, r`Choose the simplest platform meeting stated failure tolerance.`],
  ex: r`An internal reconciliation dashboard ran happily on one Compose host for three years; when it became part of month-end close it moved to a multi-AZ managed container service because downtime now blocked finance.`,
  fu: [r`What would trigger moving a Compose app to a managed platform?`, r`How do you do zero-downtime updates on a single host?`],
  pit: [r`Running payment systems on a single Compose host.`, r`Publishing database ports on the host.`, r`No off-host backups of volumes.`] },

{ id: 'q36', level: 'Senior', tags: ['image-hygiene', 'patching', 'golden-images', 'vulnerability-sla'],
  q: r`Keep hundreds of images patched: golden base images, automated base-image update PRs, rebuild cadence, handling CVEs in base layers versus application dependencies, and measuring fleet hygiene.`,
  a: r`**Problem**: images freeze dependencies at build time. A service not rebuilt for six months carries six months of new CVEs in its OS packages and runtime, even if its code never changed.

**Golden base images**
- A platform team publishes approved bases ({{base/aspnet:8.0-chiseled}}, {{base/runtime-deps:8.0-chiseled}}, {{base/node:22-slim}} for SPA build stages) in the internal registry: mirrored from vendors (Microsoft, Canonical, Chainguard...), with corporate CAs and standard labels, scanned and signed.
- Rebuilt on a schedule (weekly) and on vendor security releases (.NET Patch Tuesday monthly, OS security updates), tagged by date and digest.

**Propagation to services**
- Services pin bases by **digest**; **Renovate/Dependabot** opens PRs when a new base digest is published (and for NuGet/npm updates). CI builds, tests and, for low-risk patch updates, **auto-merges** when green.
- Services with no code changes still rebuild on base updates — the pipeline promotes them like any release.
- A **max image age** policy (for example 30 days since last rebuild for internet-facing services) enforced by dashboards and admission/audit policies.

**Triage CVEs by layer**
- **Base OS packages**: fixed by rebuilding on the updated base; chiseled/distroless bases minimise this class.
- **.NET runtime**: patched monthly in new base images — rebuild.
- **Application dependencies** (NuGet/npm): require dependency updates and code changes sometimes; owned by the service team.
- Use reachability/exploitability context and **VEX** to suppress non-applicable findings; prioritise internet-facing and payment services; SLAs (critical: days; high: weeks).

**Measure fleet hygiene**
- Image age distribution of running workloads; % running on current golden bases.
- Open critical/high CVEs in running images (not just in the registry), mean time to remediate.
- Auto-merge rate of patch PRs; services failing builds on base updates (signals test or compatibility problems).

**Organisational glue**: platform owns bases and tooling; teams own their dependencies and must accept patch PRs; exceptions are time-bound with compensating controls.`,
  code: r`~~~json
// renovate.json: track base image digests and NuGet patches; auto-merge green patch updates
{
  "extends": ["config:recommended", "docker:pinDigests"],
  "packageRules": [
    { "matchDatasources": ["docker"], "matchPackageNames": ["registry.example/base/aspnet"], "automerge": true, "schedule": ["after 6am on monday"] },
    { "matchManagers": ["nuget"], "matchUpdateTypes": ["patch"], "automerge": true },
    { "matchManagers": ["nuget"], "matchUpdateTypes": ["major"], "dependencyDashboardApproval": true }
  ]
}
~~~
~~~text
# PromQL (with an exporter publishing image build timestamps as labels/metrics): running images older than 30 days
count by (namespace) ((time() - image_build_timestamp_seconds{env="prod"}) > 30 * 86400)
~~~`,
  dia: r`flowchart LR
  VEN[Vendor bases: MCR, Canonical] --> PLAT[Platform: mirror, add CA, scan, sign - weekly + security releases]
  PLAT --> GB[(Golden base images by digest)]
  GB --> REN[Renovate PRs in service repos]
  REN --> CI[CI build + tests]
  CI -->|green patch: auto-merge| PROMO[Promote via GitOps]
  DASH[Fleet dashboard: image age, open CVEs, MTTR] --> TEAMS[Teams + platform]`,
  pts: [r`Images freeze dependencies; unchanged services still need rebuilds.`, r`Golden base images rebuilt weekly and on security releases.`, r`Pin digests; automated PRs and auto-merge for green patch updates.`, r`Triage by layer: base OS, runtime, app dependencies; VEX and SLAs.`, r`Measure image age, CVEs in running workloads and remediation time.`],
  ex: r`After introducing golden chiseled bases with Renovate auto-merge, a payments estate's median running image age fell from 74 days to 9 and open critical CVEs in production from 120 to 4.`,
  fu: [r`How do you handle a service whose build breaks on every base update?`, r`Should registry scan results or running-workload scan results drive SLAs?`],
  pit: [r`Only rebuilding images when code changes.`, r`Floating base tags instead of digest pins with automated updates.`, r`Measuring CVEs in the registry but not in running workloads.`] },

{ id: 'q37', level: 'Principal', tags: ['platform-strategy', 'containers', 'standards'],
  q: r`As Principal Engineer, define the organisation's container strategy: which workloads get containerised, the runtime/orchestration choice per workload class, golden images, build standards, and what you deliberately do not containerise.`,
  a: r`**Start with outcomes**: faster, safer delivery; consistent runtime from laptop to production; patchable, auditable artefacts; efficient infrastructure. Containers are a means.

**Workload classes and targets**
| Class | Target |
|---|---|
| Modern .NET APIs and workers (stateless) | containers on a managed container service by default (ECS Fargate / Container Apps / Cloud Run), Kubernetes where the platform exists and is justified |
| Event-driven glue, spiky short jobs | serverless functions (may be container-packaged) |
| Angular/React SPAs | built in containers in CI, **served as static assets** from CDN/object storage (no container needed at runtime), or a tiny NGINX container only when server-side features are required |
| Legacy .NET Framework apps | Windows containers as a bridge (q28) or rehost on VMs while porting |
| Databases, queues, caches | managed services; containers for dev/test only |
| Commercial off-the-shelf software | vendor-supported form (appliance, SaaS, VM) unless the vendor supports containers |
| Batch/data processing | containers on batch services or Kubernetes Jobs |

**What we do not containerise** (or not now): systems of record databases in production (managed instead), workloads with heavy licensing tied to hosts, desktop/GUI applications, apps whose porting cost exceeds remaining life (retire or rehost).

**Standards (encoded in templates and policies)**
- Golden base images per stack (chiseled .NET, Node build images), rebuilt weekly; digest pinning with automated updates.
- Dockerfile template: multi-stage, restore caching, non-root, exec form, port 8080, labels, no secrets; hadolint rules.
- Build: BuildKit with remote cache, SBOM, provenance, signing; multi-arch where ARM is a target.
- Runtime: read-only rootfs, dropped capabilities, resource limits, health endpoints, structured logs, OpenTelemetry.
- Registry: internal only, immutable tags, retention, regional replication, pull-through cache for upstream.

**Governance and support**: platform team owns templates, bases and pipelines; policy as code at build and admission; exceptions time-bound; fleet dashboards (image age, CVEs, compliance).

**Success measures**: lead time and deployment frequency, % services on golden path, median image age, critical CVE MTTR, infrastructure cost per transaction.`,
  code: r`~~~text
Container strategy - workload placement (excerpt)
Workload                      Runtime target                      Packaging           Notes
payments-api (.NET 8)         ECS Fargate / Container Apps        chiseled image      golden path
settlement-worker             same, queue-scaled                  chiseled image      KEDA / backlog scaling
statements-spa (Angular)      CDN + object storage                static build        containers only in CI
fx-rates-refresh              serverless function                 zip or image        schedule trigger
legacy-claims (.NET 4.8)      Windows containers (bridge)         servercore ltsc2022 port by 2027
ledger database               managed PostgreSQL                  -                   not containerised in prod
~~~`,
  dia: r`flowchart TD
  W[Workload] --> S{Stateless .NET service?}
  S -->|yes| MCS[Managed container service - golden path]
  S -->|no| D{Database or queue?}
  D -->|yes| MAN[Managed data service - containers for dev/test only]
  D -->|no| F{SPA?}
  F -->|yes| CDN[Static assets on CDN]
  F -->|no| L{Legacy .NET Framework?}
  L -->|yes| WIN[Windows containers as bridge / port]
  L -->|no| EV[Serverless or batch per pattern]`,
  pts: [r`Define strategy by outcomes and workload classes, not by technology.`, r`Stateless services on managed container platforms; SPAs as static assets; data in managed services.`, r`State explicitly what is not containerised.`, r`Encode standards in golden images, templates, pipelines and policies.`, r`Govern with dashboards and measure delivery, hygiene and cost.`],
  ex: r`A bank's container strategy moved 120 services onto a golden path in 18 months, served its Angular portals from a CDN instead of NGINX containers, and kept its core ledger on managed PostgreSQL.`,
  fu: [r`Why serve SPAs from a CDN rather than containers?`, r`How do you decide between a managed container service and Kubernetes?`],
  pit: [r`Containerising everything including production databases.`, r`Standards in documents instead of templates and policies.`, r`No ownership of base images.`] },

{ id: 'q38', level: 'Principal', tags: ['secure-pipeline', 'slsa', 'supply-chain', 'architecture'],
  q: r`Design an end-to-end secure container build and release pipeline for a regulated firm, targeting strong SLSA guarantees: source controls, isolated builders, provenance, signing, policy gates, and evidence for auditors.`,
  a: r`**Threat model**: compromised developer account, malicious dependency, tampered build environment, stolen signing key, direct pushes to the registry, deployment of unreviewed or untested images, and drift between what was tested and what runs.

**Architecture**
1. **Source**: protected main branch, mandatory reviews (two for critical services), signed commits for privileged repos, CODEOWNERS, branch rules preventing force-push, secret scanning, dependency review, pinned and verified actions/templates.
2. **Dependencies**: internal proxies for NuGet/npm/base images (Artifactory/ProGet/registry mirrors) with allow-listing, vulnerability and licence policies; lock files; Renovate for controlled updates.
3. **Build**: hosted, **ephemeral, isolated builders** (fresh VM or unprivileged pod per job), no human access, network egress restricted to the proxies; builds run from a defined workflow file in the repo; parameters minimal. This is what makes provenance trustworthy (SLSA Build L3-style: hardened builders, provenance generated by the platform not the job).
4. **Provenance and SBOM**: generated by the build platform (buildx attestations / SLSA generators), signed, attached to the image.
5. **Signing**: keyless signing with the workflow's OIDC identity (Sigstore) or KMS/HSM-held keys (Notation with enterprise PKI); no long-lived keys on runners.
6. **Gates**: tests, SAST, dependency and image scans with policies (fail on fixable criticals; VEX for justified exceptions), IaC policy checks.
7. **Registry**: CI-only push, immutable tags, separate repositories for candidates and released images; promotion copies the **same digest** after approvals.
8. **Deploy**: GitOps; admission policies verify signature identity (this repo, main branch, this workflow), required attestations (provenance from the trusted builder, SBOM, scan passed), allowed registries, digest pinning.
9. **Runtime**: continuous scanning of running images, runtime detection, drift detection.

**Evidence for auditors (SOX, PCI, DORA)**: for any production workload, the chain commit → review → build run → provenance → scan results → approval → deployment → running digest is queryable; change records are generated from pipeline data; retention per policy.

**Organisation**: platform security team owns the pipeline templates and policies; teams cannot bypass them (required workflows, organisation rulesets); break-glass releases are logged and reviewed.`,
  code: r`~~~yaml
# Kyverno: require trusted-builder provenance and signature for production namespaces
apiVersion: kyverno.io/v1
kind: ClusterPolicy
metadata: { name: require-slsa-provenance }
spec:
  validationFailureAction: Enforce
  rules:
    - name: verify-provenance
      match: { any: [ { resources: { kinds: [Pod], namespaceSelector: { matchLabels: { env: prod } } } } ] }
      verifyImages:
        - imageReferences: ["registry.example/*"]
          attestors:
            - entries:
                - keyless:
                    issuer: https://token.actions.githubusercontent.com
                    subjectRegExp: "^https://github.com/bank/[^/]+/.github/workflows/release.yml@refs/heads/main$"
          attestations:
            - type: https://slsa.dev/provenance/v1
              conditions:
                - all:
                    - key: "{{ buildDefinition.buildType }}"
                      operator: Equals
                      value: "https://actions.github.io/buildtypes/workflow/v1"
~~~`,
  dia: r`flowchart LR
  SRC[Protected source: reviews, signed commits] --> BLD[Ephemeral isolated builder - restricted egress]
  PROXY[Dependency proxies: NuGet, npm, base images] --> BLD
  BLD --> ATT[Platform-generated provenance + SBOM]
  BLD --> GATES[Tests, SAST, scans, policy]
  GATES --> SIGN[Keyless signature - workflow identity]
  SIGN --> REG[(Registry: CI-only push, immutable)]
  REG -->|promote same digest after approval| GITOPS[GitOps prod]
  GITOPS --> ADM[Admission: verify identity + attestations]
  ADM --> RUN[Running workload - continuous scan]`,
  pts: [r`Model threats across source, dependencies, build, registry and deploy.`, r`Ephemeral isolated builders with platform-generated provenance make guarantees credible.`, r`Sign with workload identity or HSM keys; no long-lived keys on runners.`, r`Policy gates and admission verification of identity and attestations.`, r`Make the full chain queryable as audit evidence; prevent bypass with required workflows.`],
  ex: r`After a dependency-confusion attempt was blocked by the internal NuGet proxy's allow-list, a bank's auditors accepted the pipeline's provenance chain as its primary SOX change-control evidence for containers.`,
  fu: [r`What distinguishes SLSA Build L2 from L3 in practice?`, r`How do you handle an emergency release under these controls?`],
  pit: [r`Provenance generated by user-controlled build steps.`, r`Long-lived signing keys on runners.`, r`Admission policies that accept any signer.`] },

{ id: 'q39', level: 'Principal', tags: ['legacy-migration', 'dotnet-framework', 'containerisation-strategy'],
  q: r`A 12-year-old .NET Framework 4.8 monolith (ASP.NET MVC, WCF, Windows services, SQL Server) must leave the datacentre in 9 months. Containerise it on Windows, port it to modern .NET on Linux, or rehost on VMs? Make the decision and the plan.`,
  a: r`**Constraints first**: 9-month datacentre exit (hard date), business-critical system, ongoing feature work, team familiar with .NET Framework, SQL Server dependency.

**Options**
| Option | Time to exit | Risk | Long-term value |
|---|---|---|---|
| Rehost on cloud VMs (lift and shift) | fastest (weeks-months) | lowest | low — same ops model, Windows licences, manual patching |
| Windows containers (Server Core) | medium | medium — packaging config, IIS, WCF, gMSA for Windows auth, large images | moderate — immutable deployments, orchestration, consistent pipelines; still Windows nodes |
| Port to modern .NET on Linux | slowest for a monolith (System.Web, WCF server, Windows APIs, third-party libs) | highest within 9 months | highest — smaller images, cheaper nodes, modern tooling |

**Recommended decision**: **meet the deadline with the lowest-risk path, then modernise incrementally**.
1. **Months 0-6**: rehost on VMs or Windows containers — choose containers if the platform already supports Windows node pools and the team can learn quickly; otherwise VMs with automation (IaC, golden AMIs, pipeline deployments). Move SQL Server to a managed instance (Azure SQL MI / RDS for SQL Server).
2. **In parallel**: prepare for porting — upgrade dependencies, run the .NET Upgrade Assistant analysis, extract configuration to environment-based providers, remove machine-level state, introduce health endpoints and structured logging (these help any target).
3. **Months 6-24**: **strangler fig** — put a gateway in front, carve out capabilities into modern .NET services on Linux containers (new features land there), migrate WCF consumers to gRPC/REST (or host with CoreWCF), move Windows services to worker services. The monolith shrinks; its Windows footprint follows.
4. **Decommission** Windows containers/VMs when the remaining monolith is small enough to port or retire.

**Why not a big-bang port now**: rewrite risk on a business-critical system under a hard deadline is the classic way to miss both the deadline and quality. **Why not stop at rehost**: licence costs, patching burden and slower delivery persist.

**Governance**: explicit milestones, a decision log, risk register (Windows container gaps, WCF, auth), and a business case showing cost reductions per phase.`,
  code: r`~~~csharp
// Strangler step: new capability in .NET 8 on Linux, legacy routes proxied to the Windows-hosted monolith (YARP)
builder.Services.AddReverseProxy().LoadFromMemory(
    [
        new RouteConfig { RouteId = "claims-v2", ClusterId = "claims-new", Match = new() { Path = "/api/claims/{**rest}" } },
        new RouteConfig { RouteId = "legacy", ClusterId = "monolith", Order = 1000, Match = new() { Path = "{**all}" } }
    ],
    [
        new ClusterConfig { ClusterId = "claims-new", Destinations = new Dictionary<string, DestinationConfig> { ["a"] = new() { Address = "http://claims-api:8080/" } } },
        new ClusterConfig { ClusterId = "monolith",   Destinations = new Dictionary<string, DestinationConfig> { ["a"] = new() { Address = "http://legacy-portal.windows.internal/" } } }
    ]);
~~~`,
  dia: r`flowchart LR
  U[Users] --> GW[Gateway - strangler routing]
  GW -->|/api/claims| NEW[Claims service - .NET 8, Linux containers]
  GW -->|everything else| MONO[Monolith - Windows containers or VMs - 9-month exit]
  MONO --> SQL[(Managed SQL Server)]
  NEW --> SQL
  MONO -.shrinks over 24 months.-> RET[Retire / final port]`,
  pts: [r`Hard deadlines favour the lowest-risk exit path.`, r`Rehost or Windows containers to exit; managed SQL Server.`, r`Prepare for porting in parallel: config, state, health, logging.`, r`Strangler fig to modern .NET on Linux; new features land on the new stack.`, r`Explicit milestones, risk register and business case per phase.`],
  ex: r`An insurer exited its datacentre on time with Windows containers on AKS, then strangled 70% of the claims monolith into .NET 8 Linux services over two years, cutting Windows node spend by 60%.`,
  fu: [r`How do you handle WCF clients you do not control?`, r`What would make you choose VMs over Windows containers for the bridge?`],
  pit: [r`Big-bang rewrite under a hard deadline.`, r`Treating rehost as the end state.`, r`Ignoring Windows authentication and gMSA requirements.`] },

{ id: 'q40', level: 'Principal', tags: ['developer-experience', 'devcontainers', 'inner-loop', 'parity'],
  q: r`Design the developer experience for 40 full-stack teams using containers: local environments (Compose, devcontainers, Tilt/Skaffold, remote dev environments), dev/prod parity, fast inner loops for .NET and Angular/React, and onboarding.`,
  a: r`**Goals**: a new engineer runs the full stack and ships a change on day one; the inner loop (edit → see result) stays in seconds; environments behave like production where it matters (versions, config shape, dependencies), without production's weight.

**Building blocks**
- **Dev containers** ({{devcontainer.json}}): a reproducible toolchain (SDKs, Node, CLI tools, linters, certificates, proxy settings) for VS Code, Visual Studio/Rider support, and Codespaces/remote hosts. Eliminates "works on my machine" for tooling.
- **Compose** for dependencies (databases, Redis, brokers, mocks of external APIs such as PSP sandboxes via WireMock), with profiles for optional components and seed/migration jobs.
- **Run the code you are editing natively** (dotnet watch with hot reload, Angular/React dev servers with HMR) against containerised dependencies — fastest loop. Containerise the edited service only for container-specific debugging.
- **Kubernetes-based dev** (Tilt, Skaffold, Telepresence/mirrord) when services must run in a cluster with many dependencies: sync code into running pods or route cluster traffic to a local process.
- **Remote development environments** (Codespaces, Dev Box, Gitpod/Coder) for heavy stacks, regulated data restrictions, or thin laptops — also solves Apple Silicon vs amd64 mismatches.

**Parity rules**: same dependency versions as production (pinned), same configuration keys (values differ), the production image used in CI integration tests, and a "prod-like" profile developers can run occasionally (non-root, read-only, limits, amd64).

**Platform support**
- Templates: new-service scaffolds include Dockerfile, compose file, devcontainer, test setup with Testcontainers.
- Shared mocks for external providers; seed data generators (no production data on laptops — privacy/regulatory).
- Internal registry mirror, CA and proxy pre-configured; documented troubleshooting.
- Measure: time to first PR for new joiners, inner-loop latency, local environment issues reported, CI-vs-local failure mismatches.`,
  code: r`~~~json
// .devcontainer/devcontainer.json for a .NET + Angular service
{
  "name": "payments-fullstack",
  "image": "registry.example/devcontainers/dotnet-node:8.0-22",
  "features": { "ghcr.io/devcontainers/features/docker-outside-of-docker:1": {} },
  "dockerComposeFile": ["../compose.yaml"],
  "service": "workspace",
  "runServices": ["db", "redis", "psp-mock"],
  "forwardPorts": [4200, 8080],
  "postCreateCommand": "dotnet restore && npm ci --prefix web",
  "customizations": { "vscode": { "extensions": ["ms-dotnettools.csdevkit", "angular.ng-template", "ms-azuretools.vscode-docker"] } },
  "containerEnv": { "ASPNETCORE_ENVIRONMENT": "Development", "Psp__BaseUrl": "http://psp-mock:8080" }
}
~~~`,
  dia: r`flowchart LR
  DEV[Developer] --> DC[Dev container: SDKs, tools, CA, proxy]
  DC -->|dotnet watch, ng serve - hot reload| CODE[Code being edited - native speed]
  CODE --> DEPS[Compose deps: db, redis, broker, PSP mock]
  DC -.heavy stacks.-> REMOTE[Remote dev env / Codespaces]
  CI[CI: same image + Testcontainers] -.parity.-> DEPS`,
  pts: [r`Dev containers make toolchains reproducible.`, r`Compose for dependencies; run edited code natively with hot reload.`, r`Tilt/Skaffold/mirrord or remote environments for cluster-heavy stacks.`, r`Parity: pinned versions, same config keys, prod image tested in CI, a prod-like profile.`, r`Templates, mocks, synthetic data and onboarding metrics.`],
  ex: r`A bank cut new-joiner time to first merged PR from 9 days to 1 by shipping devcontainers, a compose stack with a PSP mock, and synthetic seed data in every service template.`,
  fu: [r`How do you give developers realistic data without production data on laptops?`, r`When are remote dev environments worth their cost?`],
  pit: [r`Running every service in containers locally with slow rebuild loops.`, r`Production data copied to laptops.`, r`Dependency versions differing from production.`] },

{ id: 'q41', level: 'Principal', tags: ['pci-dss', 'immutability', 'patching', 'audit'],
  q: r`How do containers help — and complicate — PCI DSS and SOX compliance? Cover immutable infrastructure, patching cadence evidence, file integrity monitoring, logging, access to running containers, and image provenance.`,
  a: r`**Where containers help**
- **Immutability**: images are built, scanned, signed and deployed by digest; running containers are not patched in place — they are **replaced**. This makes configuration standards (PCI Req. 2) and change control (Req. 6, SOX ITGC) easier to evidence: what runs is exactly what was approved.
- **Reproducible patching**: patching = rebuild on updated golden base + redeploy through the pipeline; evidence is the pipeline record and image age metrics (PCI Req. 6.3 requires timely installation of security patches; critical within defined timelines based on risk).
- **Minimal attack surface**: chiseled/distroless images with no shells reduce what an attacker can do and what assessors must evaluate.
- **Consistent hardening** through templates and admission policies (non-root, read-only rootfs, capabilities).

**Where they complicate**
- **Scope**: shared hosts/clusters can pull non-CDE workloads into scope (see Kubernetes q39); segmentation must be demonstrated at network, node and identity layers.
- **File integrity monitoring (Req. 11.5)**: traditional host FIM does not fit ephemeral containers — use read-only root filesystems (integrity by construction), image signing (integrity of what starts), and runtime detection of unexpected file changes/processes (Falco or cloud runtime protection); FIM on hosts/nodes still applies.
- **Logging (Req. 10)**: containers are short-lived — logs must be shipped centrally in near real time with retention (12 months, 3 immediately available), including orchestrator audit logs and registry access logs.
- **Access to running containers**: {{docker exec}}/{{kubectl exec}} into CDE workloads is privileged access — restrict to break-glass, MFA, session recording, alerts.
- **Vulnerability management (Req. 6.3, 11.3)**: scanning must cover running images continuously, with risk ranking and remediation timelines; quarterly internal/external scans still apply to exposed endpoints.
- **Inventory (Req. 12.5)**: a current inventory of system components — derive from the registry, SBOMs and orchestrator state.

**Evidence package**: golden image standards and their rebuild records; pipeline provenance from commit to running digest; scan reports and remediation SLAs; admission policy definitions and violation reports; access control and break-glass logs; segmentation tests.`,
  code: r`~~~yaml
# Falco rule (runtime detection, complements read-only rootfs): alert on shells or writes in CDE containers
- rule: Shell or write in CDE container
  desc: Interactive shell spawned or file written under /app in a cardholder-data workload
  condition: >
    container and k8s.ns.name = "cde-tokenisation" and
    ((spawned_process and proc.name in (sh, bash, ash, dash)) or
     (open_write and fd.name startswith /app))
  output: "CDE integrity alert (user=%user.name cmd=%proc.cmdline file=%fd.name pod=%k8s.pod.name image=%container.image.repository)"
  priority: CRITICAL
  tags: [pci_dss_11.5, pci_dss_10.2]
~~~`,
  dia: r`flowchart LR
  GB[Golden base rebuilt weekly] --> BUILD[Pipeline: scan, sign, provenance]
  BUILD --> REG[(Registry: immutable digests)]
  REG --> RUN[Running CDE containers - read-only rootfs]
  RUN --> LOGS[Central logs + audit logs - 12 months]
  RUN --> RT[Runtime detection - FIM alternative]
  EXEC[Break-glass exec only - MFA, recorded] --> RUN
  BUILD --> EV[Evidence: provenance, scans, approvals, image age]`,
  pts: [r`Immutability and replace-not-patch simplify change control and configuration evidence.`, r`Patching evidence = golden base rebuild + pipeline records + image age.`, r`FIM via read-only rootfs, signatures and runtime detection, plus host FIM.`, r`Ship logs centrally with PCI retention; restrict and record exec access.`, r`Inventory and vulnerability evidence from registry, SBOMs and orchestrator state.`],
  ex: r`A payment processor replaced in-place patching of CDE VMs with weekly golden-image rebuilds and redeploys; the QSA accepted pipeline records and image-age dashboards as patch evidence.`,
  fu: [r`How would you answer an assessor asking for FIM on containers?`, r`How do you prove what was running in the CDE on a specific date?`],
  pit: [r`Patching running containers in place.`, r`Logs kept only on nodes.`, r`Unrestricted exec into CDE workloads.`] },

{ id: 'q42', level: 'Principal', tags: ['registry-architecture', 'cost', 'egress', 'multi-region'],
  q: r`Design the container registry architecture for a multi-region, multi-cloud estate: where images live, replication, pull-through caching, network paths and egress cost, availability, access control and retention.`,
  a: r`**Requirements**: fast and reliable pulls close to every cluster; no dependency on public registries at deploy or scale time; strict control over what can be pushed and pulled; affordable storage and egress; evidence of provenance.

**Topology**
- **Primary registry per cloud** (ECR, ACR, Artifact Registry) or a cloud-agnostic registry (Harbor, Artifactory) — choose based on where workloads run and identity integration. Native registries integrate with IAM/managed identities, private endpoints and node image pulling with no credentials.
- **Geo-replication** to every region with clusters (ECR replication rules, ACR geo-replication Premium, Artifact Registry multi-region) — regional pulls are faster, avoid cross-region data transfer charges during scale-out, and survive a regional registry incident.
- **Upstream caching**: pull-through cache for Docker Hub, MCR, GHCR, Quay; or mirror an approved list into golden repositories (preferred for production). Clusters pull **only** from internal registries (admission policy).
- **Multi-cloud**: replicate signed images between clouds by digest ({{crane copy}}, registry replication features); signatures and attestations travel with them (OCI referrers).

**Network paths and cost**
- Private connectivity (VPC endpoints/Private Link) from clusters to registries — avoids NAT processing charges, which can be significant for large images during node churn.
- Image size discipline (chiseled bases, shared layers) directly reduces transfer and storage cost.
- Lazy loading/streaming for very large images.

**Access control**: push only by CI identities per repository namespace; pull by workload identities/node roles scoped to needed repositories; no human push to production repositories; separate repositories (or registries) for candidate vs released images; audit logs to SIEM.

**Availability**: registry outages block scale-out and node replacement — regional replicas, pre-pulled critical images on node images (system/sidecar images), and caching layers on nodes reduce exposure; monitor pull errors and latency.

**Retention and lifecycle**: delete untagged images and old SHA builds while retaining anything deployed in the last N months (reconcile with cluster/GitOps inventories) and release tags required for audit/rollback; storage tiering where supported.`,
  code: r`~~~json
// ECR replication configuration: replicate production repositories to two regions
{
  "rules": [
    {
      "destinations": [ { "region": "eu-central-1", "registryId": "111122223333" }, { "region": "eu-west-2", "registryId": "111122223333" } ],
      "repositoryFilters": [ { "filter": "prod/", "filterType": "PREFIX_MATCH" } ]
    }
  ]
}
~~~
~~~bash
# ECR pull-through cache for an upstream registry (MCR) - clusters reference the internal path only
aws ecr create-pull-through-cache-rule --ecr-repository-prefix mcr --upstream-registry-url mcr.microsoft.com
# image: 111122223333.dkr.ecr.eu-west-1.amazonaws.com/mcr/dotnet/aspnet:8.0-noble-chiseled
~~~`,
  dia: r`flowchart LR
  UP[Public registries: Docker Hub, MCR, GHCR] -->|pull-through / mirror| PRI[(Primary registry - eu-west-1)]
  CI[CI push - signed digests] --> PRI
  PRI -->|replication| R2[(Registry eu-central-1)]
  PRI -->|cross-cloud copy by digest| R3[(ACR - Azure region)]
  PRI -->|private endpoint| K1[Clusters eu-west-1]
  R2 -->|private endpoint| K2[Clusters eu-central-1]
  R3 --> K3[AKS clusters]`,
  pts: [r`Internal registries only at deploy/scale time; mirror or cache upstream images.`, r`Replicate to every region with clusters; copy signed digests across clouds.`, r`Private endpoints and small images cut egress and NAT costs.`, r`CI-only push, workload-identity pulls, separate candidate and release repositories.`, r`Plan for registry outages; retention reconciled with what is deployed.`],
  ex: r`During a regional scale-out, pulls of a 900 MB image through NAT cost a payments team thousands per month and slowed recovery; regional replicas behind VPC endpoints and chiseled images cut both.`,
  fu: [r`How do signatures and attestations travel with replicated images?`, r`What happens to scale-out if the registry is down?`],
  pit: [r`Clusters pulling directly from public registries.`, r`Cross-region pulls during scale events.`, r`Retention policies that delete images still deployed.`] },

{ id: 'q43', level: 'Principal', tags: ['runtime-choice', 'containerd', 'podman', 'cri-o'],
  q: r`Choose container runtimes and engines for each context — developer laptops, CI builders, Kubernetes nodes, standalone servers, and edge devices: Docker Engine, containerd, CRI-O, Podman, and sandboxed runtimes. Justify the choices.`,
  a: r`**Principle**: images are OCI-standard, so runtime choice is about **operations, security and integration**, not portability of applications.

| Context | Typical choice | Why |
|---|---|---|
| **Developer laptops** | Docker Desktop (Business) or Podman/Rancher Desktop | tooling compatibility (Compose, Testcontainers, devcontainers), management controls (q34) |
| **CI builders** | BuildKit (rootless) or Buildah on ephemeral runners; hosted VM runners for untrusted code | no privileged daemons or docker.sock; cache and attestation support (q21) |
| **Kubernetes nodes** | **containerd** (default on EKS, AKS, GKE) or **CRI-O** (OpenShift) | CRI-native, minimal, managed by the provider's node images; Docker Engine on nodes is unnecessary since dockershim removal |
| **Standalone servers** (single-host apps, appliances) | Docker Engine (Compose) or Podman with systemd (Quadlet) | Docker for familiarity and Compose; Podman for daemonless, rootless operation integrated with systemd units |
| **Edge / constrained devices** | containerd with k3s/k0s, or Podman | small footprint, offline operation, OTA updates |
| **Untrusted / multi-tenant code** | gVisor, Kata Containers, Firecracker via RuntimeClass or managed services | stronger isolation (q23) |

**Security comparisons**
- Docker's root daemon is a high-value target; **rootless modes** (Docker rootless, Podman rootless) reduce impact.
- containerd/CRI-O on managed nodes: patched via node image updates — speed of rolling node images is the key control (runc CVEs).
- Daemonless Podman: no long-lived privileged daemon; containers are child processes of the user/systemd.

**Operational considerations**: standardise per context (not one tool everywhere), keep tooling OCI-standard (Compose spec, Dockerfile/Containerfile, OCI registries), document debugging per runtime ({{crictl}} on nodes, {{nerdctl}}, {{podman}}), and track runtime CVEs with fast patch paths.`,
  code: r`~~~ini
# Podman Quadlet on a standalone server: a systemd-managed, rootless container (~/.config/containers/systemd/reporting.container)
[Unit]
Description=Reporting API
After=network-online.target

[Container]
Image=registry.example/reporting@sha256:c41b...
PublishPort=127.0.0.1:8080:8080
ReadOnly=true
DropCapability=ALL
NoNewPrivileges=true
Secret=reporting-db,type=mount,target=/run/secrets/db
HealthCmd=dotnet Reporting.dll --healthcheck
AutoUpdate=registry

[Install]
WantedBy=default.target
~~~`,
  dia: r`flowchart LR
  LAP[Laptops] --> DD[Docker Desktop / Podman Desktop]
  CI[CI] --> BK[Rootless BuildKit / Buildah]
  K8S[Kubernetes nodes] --> CTD[containerd / CRI-O]
  SRV[Standalone servers] --> PQ[Docker Engine + Compose or Podman + Quadlet]
  EDGE[Edge] --> K3S[k3s + containerd]
  UNT[Untrusted code] --> SBX[gVisor / Kata / Firecracker]
  ALL[All produce/consume OCI images] -.-> REG[(OCI registry)]`,
  pts: [r`OCI standards make runtime choice an operations and security decision.`, r`containerd/CRI-O on Kubernetes nodes; no Docker Engine needed.`, r`Rootless BuildKit/Buildah in CI; Docker or Podman on laptops by compatibility and controls.`, r`Docker Engine or Podman Quadlet for standalone servers; containerd/k3s at the edge.`, r`Sandboxed runtimes for untrusted code; fast runtime patching everywhere.`],
  ex: r`A retailer ran its in-store edge services on k3s with containerd and its back-office single-host tools as rootless Podman Quadlets, while all images came from the same signed OCI pipeline.`,
  fu: [r`What changes for debugging when nodes run containerd instead of Docker?`, r`Why might Podman suit regulated standalone servers?`],
  pit: [r`Installing Docker Engine on Kubernetes nodes out of habit.`, r`Root daemons on shared CI.`, r`Slow node-image rollouts for runtime CVEs.`] },

{ id: 'q44', level: 'Principal', tags: ['vulnerability-management', 'vex', 'risk', 'program'],
  q: r`Build a container vulnerability management programme that teams trust: scanning coverage, prioritisation beyond CVSS, VEX and exceptions, SLAs, ownership, and metrics for executives and regulators.`,
  a: r`**The problem**: scanners report thousands of CVEs across hundreds of images; most are unreachable or low risk; teams drown, ignore the noise and miss the critical ones. A programme must turn findings into **prioritised, owned work**.

**Coverage**
- Scan at build (gate), in the registry (continuous, new CVEs appear daily), and **running workloads** (what actually matters) — tie each running image to its owner via labels/service catalogue.
- Cover OS packages, language dependencies (NuGet, npm), base images and, separately, IaC and cluster configuration.

**Prioritisation beyond CVSS**
- **Exploitability**: known exploited (CISA KEV), EPSS probability, public exploit availability.
- **Exposure**: internet-facing, handles payments/PII, privileged context.
- **Reachability**: is the vulnerable package/function loaded and called? (SCA reachability, runtime package usage data.)
- **Fix availability**: fixable now vs no fix (then mitigations).
Example priority: KEV + internet-facing + fix available = P1 (days); high CVSS but unreachable in a batch job = low.

**VEX and exceptions**: record "not affected" decisions (VEX: component not present, vulnerable code not reachable, mitigated) in machine-readable form attached to images so scanners suppress them consistently; exceptions with owner, justification, compensating control and expiry.

**Remediation paths**
- Base layer CVEs → golden base rebuild + automated PRs (q36) — mostly automated.
- Dependency CVEs → Renovate PRs; for transitive dependencies, overrides with tests.
- No fix → mitigations (WAF rules, config changes, removing the package, isolation) and tracking.

**SLAs and ownership**: by priority (P1 7 days, P2 30 days, P3 90 days, for example), owned by service teams with platform support; platform owns base images and tooling; security owns policy and verification.

**Metrics**
- For executives/regulators: open P1/P2 in production by business service, SLA compliance, mean time to remediate, trend over time, exceptions count and age.
- For teams: actionable lists sorted by priority, auto-merge rates, image age.
Regulators (DORA, PCI 6.3) expect a documented, risk-based process with evidence — not zero CVEs.`,
  code: r`~~~json
// OpenVEX statement attached to an image: CVE present in a package but not exploitable here
{
  "@context": "https://openvex.dev/ns/v0.2.0",
  "@id": "https://vex.bank.example/payments-api/2026-10-11-1",
  "author": "payments-security@bank.example",
  "timestamp": "2026-10-11T09:00:00Z",
  "statements": [
    {
      "vulnerability": { "name": "CVE-2026-12345" },
      "products": [ { "@id": "pkg:oci/payments-api@sha256%3A9c1e..." } ],
      "status": "not_affected",
      "justification": "vulnerable_code_not_in_execute_path",
      "impact_statement": "The affected XML parser feature is never invoked; service only parses JSON."
    }
  ]
}
~~~
~~~bash
trivy image --vex vex/payments-api.openvex.json --severity CRITICAL,HIGH registry.example/payments-api@sha256:9c1e...
~~~`,
  dia: r`flowchart LR
  SCAN[Build + registry + runtime scans] --> ENR[Enrich: KEV, EPSS, exposure, reachability, owner]
  ENR --> PRI{Priority}
  PRI -->|P1 KEV + exposed| FAST[Fix in days]
  PRI -->|P2| MED[Fix in 30 days]
  PRI -->|not affected| VEX[VEX statement - suppressed consistently]
  FAST --> AUTO[Base rebuild / Renovate PRs]
  MED --> AUTO
  AUTO --> MET[Metrics: SLA compliance, MTTR, open P1 by service]`,
  pts: [r`Scan build, registry and running workloads, tied to owners.`, r`Prioritise by exploitation, exposure, reachability and fix availability, not CVSS alone.`, r`VEX for not-affected decisions; time-bound exceptions.`, r`Automate base and dependency remediation; SLAs by priority.`, r`Report risk-based metrics to executives and regulators.`],
  ex: r`Switching from CVSS-only to KEV/EPSS/exposure prioritisation cut a bank's "critical" queue from 3,400 findings to 41 real P1s, which teams cleared within the SLA for the first time.`,
  fu: [r`How do you get reachability data for .NET dependencies?`, r`How do you report vulnerability risk to a board?`],
  pit: [r`Chasing every CVSS 9 regardless of exposure.`, r`Spreadsheet exceptions without expiry.`, r`Scanning images in the registry but not what is running.`] },

{ id: 'q45', level: 'Principal', tags: ['architecture-review', 'dockerfile-review'],
  q: r`Review this Dockerfile and runtime setup: FROM mcr.microsoft.com/dotnet/sdk:latest; COPY . .; RUN dotnet restore and publish; ENV ConnectionStrings__Db with a password; EXPOSE 80; CMD dotnet out/Api.dll (shell form); run with --privileged, -v /var/run/docker.sock, no limits, logs written to /app/logs. Prioritise findings and give the fixed version.`,
  a: r`**Critical**
1. **Password in ENV** — embedded in the image config and history; anyone who can pull the image has the database password. Rotate it now; supply secrets at runtime (secret store, mounted file, or managed identity) and scan the registry for other leaks.
2. **--privileged + docker.sock** — any compromise of the API is host root and control of every container. Remove both; nothing in a web API needs them.
3. **Runs as root** (SDK image default) — combined with the above, escapes are trivial; run as the non-root app user.

**High**
4. **SDK image as runtime, :latest** — ~800 MB+ with compilers and hundreds of CVEs, non-reproducible builds (latest moves), different code on different nodes. Multi-stage build; runtime/chiseled image pinned by digest.
5. **COPY . . before restore** — no layer caching (every change restores everything), and without .dockerignore the context may include bin/obj, .git, local secrets.
6. **Shell-form CMD** — {{/bin/sh}} is PID 1, SIGTERM is not forwarded, every stop becomes a SIGKILL after the timeout; in-flight requests dropped. Exec-form ENTRYPOINT.
7. **No resource limits** — a leak or spike can starve the host; set memory/CPU/pids limits.
8. **Logs to /app/logs** — lost on restart, fill the writable layer, invisible to the platform; log to stdout as JSON.

**Medium**
9. {{EXPOSE 80}} with .NET 8+ defaults to 8080 and non-root cannot bind 80 — align ports.
10. No health check endpoint, no labels/provenance, no read-only rootfs, no capability drop, no scanning/signing in the pipeline.

**How to present**: rotate the secret first (incident), then a fixed Dockerfile and run configuration as a PR, then pipeline guard rails (hadolint, secret scanning, admission policies) so the class of problem cannot recur.`,
  code: r`~~~dockerfile
# Fixed version
# syntax=docker/dockerfile:1
FROM mcr.microsoft.com/dotnet/sdk:8.0@sha256:<pinned> AS build
WORKDIR /src
COPY *.sln Directory.Packages.props nuget.config ./
COPY src/Api/Api.csproj src/Api/
RUN --mount=type=cache,id=nuget,target=/root/.nuget/packages dotnet restore src/Api/Api.csproj
COPY src/ src/
RUN --mount=type=cache,id=nuget,target=/root/.nuget/packages \
    dotnet publish src/Api -c Release --no-restore -o /app/publish -p:UseAppHost=false

FROM mcr.microsoft.com/dotnet/aspnet:8.0-noble-chiseled@sha256:<pinned>
WORKDIR /app
COPY --from=build --chown=$APP_UID:$APP_UID /app/publish .
USER $APP_UID
ENV ASPNETCORE_HTTP_PORTS=8080
EXPOSE 8080
ENTRYPOINT ["dotnet", "Api.dll"]
~~~
~~~bash
# Runtime: no privileged, no socket, limits, read-only, secret as a mounted file, logs to stdout
docker run -d --name api --user 1654 --read-only --tmpfs /tmp --cap-drop=ALL \
  --security-opt no-new-privileges --memory=768m --cpus=1 --pids-limit=256 \
  -v /etc/api/secrets/db_conn:/run/secrets/db_conn:ro -e ConnectionStrings__Db__File=/run/secrets/db_conn \
  -p 127.0.0.1:8080:8080 registry.example/api@sha256:<digest>
~~~`,
  dia: r`flowchart LR
  subgraph Before
    B1[sdk:latest, root, ENV password] --> B2[--privileged + docker.sock]
    B2 --> HOST[Host compromise path]
  end
  subgraph After
    A1[Multi-stage, chiseled, pinned, non-root] --> A2[Exec form, port 8080, stdout logs]
    A2 --> A3[Runtime: read-only, cap-drop, limits, mounted secret]
  end`,
  pts: [r`Rotate the leaked password first; secrets never in ENV.`, r`Remove --privileged and docker.sock; run non-root.`, r`Multi-stage, chiseled, digest-pinned images with restore caching.`, r`Exec-form entrypoint, port 8080, stdout logging, resource limits.`, r`Add guard rails: hadolint, secret scanning, admission policies.`],
  ex: r`In a real review of this pattern, registry scanning found the same embedded password in 14 older image versions; all were deleted after rotation and a pipeline secret scan was made mandatory.`,
  fu: [r`What would you check in logs to see whether the leaked password was used?`, r`How do you stop this Dockerfile pattern recurring across 40 teams?`],
  pit: [r`Fixing the Dockerfile without rotating the secret.`, r`Keeping docker.sock "for monitoring".`, r`Leaving the SDK image in production for convenience.`] },

{ id: 'q46', level: 'Principal', tags: ['incident', 'registry-outage', 'rate-limits', 'resilience'],
  q: r`Incident leadership: a public registry outage (or rate limiting) stops new pods from starting across several clusters during a traffic peak — scale-out and node replacements fail with ImagePullBackOff. Run the response and define the structural fixes.`,
  a: r`**Immediate response**
1. **Declare and scope**: which images fail (third-party sidecars, base images, operators?), which clusters, what is the customer impact (running pods keep serving; capacity cannot grow; failed nodes are not replaced).
2. **Protect running capacity**: pause node consolidation/scale-in and non-urgent deployments (an Argo CD sync freeze), so working pods are not evicted and replaced by pods that cannot pull.
3. **Restore pulls**:
   - If images exist on some nodes, cordon/schedule onto nodes that have them cached (short-term).
   - Authenticate pulls (rate limits are higher for authenticated accounts) if that is the cause.
   - Re-point manifests to an internal copy: copy the needed images into the internal registry from any node or cache that has them ({{crane copy}} if the upstream is reachable intermittently; or export from a node's containerd and import) and update image references (by digest) through GitOps.
4. **Communicate** impact and ETA; track actions in the timeline.

**Root causes (typical)**: clusters depending on public registries at runtime; images referenced by public paths in Helm charts/operators (sidecars, CNI add-ons, init containers); no pull-through cache; no regional replication; large images slowing recovery.

**Structural fixes**
- **All images from internal registries**: mirror third-party images (including those inside Helm charts and operators — override image repositories in values) into golden repositories; pull-through cache for the rest; admission policy rejecting non-internal registries.
- **Regional replication** of internal registries; private endpoints.
- **Pre-pulled critical images** baked into node images (CNI, CSI, mesh/agents) so nodes can join without registry access.
- **imagePullPolicy IfNotPresent** with digests (pulls only when missing); avoid {{Always}} with mutable tags.
- **Chaos test**: block egress to public registries in a staging cluster and verify everything still schedules.
- Monitoring: alert on ImagePullBackOff counts and pull latency per registry.`,
  code: r`~~~bash
# Emergency: copy the failing sidecar image into the internal registry by digest and repoint via GitOps
crane copy docker.io/bitnami/kubectl@sha256:5a2e... registry.example/mirror/bitnami/kubectl@sha256:5a2e...
yq -i '.sidecar.image.repository = "registry.example/mirror/bitnami/kubectl"' charts/platform/values-prod.yaml
# Find every image in use that is not from the internal registry (structural follow-up)
kubectl get pods -A -o jsonpath='{range .items[*]}{range .spec.containers[*]}{.image}{"\n"}{end}{range .spec.initContainers[*]}{.image}{"\n"}{end}{end}' \
  | sort -u | grep -v '^registry.example/'
~~~
~~~yaml
# Kyverno: only internal registries may be used
apiVersion: kyverno.io/v1
kind: ClusterPolicy
metadata: { name: internal-registries-only }
spec:
  validationFailureAction: Enforce
  rules:
    - name: allowed-registries
      match: { any: [ { resources: { kinds: [Pod] } } ] }
      validate:
        message: "Images must come from registry.example"
        pattern:
          spec:
            =(initContainers): [ { image: "registry.example/*" } ]
            containers: [ { image: "registry.example/*" } ]
~~~`,
  dia: r`flowchart TD
  OUT[Public registry outage / rate limit] --> FAIL[ImagePullBackOff on new pods and nodes]
  FAIL --> P1[Pause scale-in, consolidation, deploys]
  P1 --> P2[Copy images to internal registry by digest]
  P2 --> P3[Repoint via GitOps]
  P3 --> REC[Recovery]
  REC --> FIX[Structural: mirror all images, replication, pre-pulled node images, admission policy, chaos test]`,
  pts: [r`Running pods keep serving; protect them by pausing scale-in and deploys.`, r`Restore pulls by copying images internally and repointing by digest.`, r`Root cause: runtime dependency on public registries, often hidden in charts and operators.`, r`Mirror everything, replicate regionally, pre-pull critical node images, enforce by admission.`, r`Chaos-test public registry loss and alert on pull failures.`],
  ex: r`During a Black Friday peak, a public registry rate limit blocked a logging sidecar on new nodes; pausing consolidation kept existing capacity, and the post-incident mirror-everything policy removed 37 public image references.`,
  fu: [r`How do you find public image references hidden in Helm charts and operators?`, r`Why does imagePullPolicy Always with tags increase outage risk?`],
  pit: [r`Letting consolidation evict working pods during the incident.`, r`Fixing only the one failing image.`, r`Public registries in the critical path of node bootstrap.`] },

{ id: 'q47', level: 'Principal', tags: ['build-infrastructure', 'multi-tenant-ci', 'secrets', 'isolation'],
  q: r`Secure shared build infrastructure used by 40 teams: runner isolation, untrusted contributions, secrets exposure, cache poisoning, network egress, and how you limit the blast radius of a compromised build.`,
  a: r`**Threats**: a malicious or compromised dependency/PR running code on a runner; one team's job reading another team's secrets or artefacts; persistent malware on reused runners; poisoned build caches feeding later builds; exfiltration of signing credentials or cloud tokens; builds pushing to production registries.

**Runner isolation**
- **Ephemeral runners**: a fresh VM or pod per job, destroyed afterwards — no persistence between jobs or teams.
- **Pools by trust level**: untrusted (fork PRs, external contributions) on isolated VMs with no secrets and no network to internal systems; trusted (main branch) runners with access to internal proxies and registries; production-release runners further restricted.
- No privileged containers or docker.sock (rootless BuildKit/Buildah, q21); sandboxed runtimes or VMs for untrusted code.

**Secrets**
- No long-lived secrets on runners: **OIDC federation** to clouds, registries and signing (short-lived, scoped by repo/branch/environment claims).
- Secrets only exposed to jobs on protected branches/environments; never to PR workflows from forks.
- Masking is not protection — assume a malicious job can print or exfiltrate whatever it receives; scope tightly.

**Caches and artefacts**
- **Cache poisoning**: a PR job writing to a cache later consumed by main-branch builds can inject malicious content. Separate caches by trust level (PR caches read-only from main, never written back), key caches by branch, and rely on lock files/checksums for dependencies.
- Artefacts and images from PR builds go to non-production repositories.

**Network egress**: runners reach only dependency proxies, internal registries and required services; deny direct internet where possible (forces dependency allow-listing and blocks exfiltration channels); log egress.

**Blast radius limits**: per-team runner groups and cloud roles; deploy credentials only in deployment jobs gated by environments; registry push rights per repository; admission policies verifying signatures from the release workflow identity only (a compromised PR job cannot produce a deployable image).

**Detection**: audit logs of runner jobs, unusual egress, secret usage anomalies, signing transparency logs monitored for unexpected identities.`,
  code: r`~~~yaml
# GitHub Actions: PR builds get no secrets and no write permissions; release jobs use OIDC and an environment gate
on: { pull_request: {}, push: { branches: [main] } }
permissions: { contents: read }
jobs:
  build:
    runs-on: [self-hosted, ephemeral, untrusted]      # isolated pool for PRs
    if: github.event_name == 'pull_request'
    steps:
      - uses: actions/checkout@v4
      - run: docker buildx build --cache-from type=gha,scope=main .   # read main cache, never write it
  release:
    runs-on: [self-hosted, ephemeral, trusted]
    if: github.ref == 'refs/heads/main'
    environment: release                              # protected: required reviewers
    permissions: { contents: read, id-token: write, packages: write }
    steps:
      - uses: actions/checkout@v4
      - run: docker buildx build --cache-to type=gha,scope=main,mode=max --push -t registry.example/payments-api:$GITHUB_SHA .
~~~`,
  dia: r`flowchart LR
  PR[Fork PR] --> UNT[Untrusted ephemeral VM pool - no secrets, no internal network]
  MAIN[Main branch] --> TR[Trusted ephemeral pool - proxies only egress]
  TR --> REL[Release job - environment gate, OIDC short-lived creds]
  REL --> REG[(Prod registry - push only from release identity)]
  UNT -->|read-only| CACHE[(Main build cache)]
  TR -->|write| CACHE
  REG --> ADM[Admission: only release workflow signatures]`,
  pts: [r`Ephemeral runners segmented by trust level; no privileged builds.`, r`OIDC short-lived credentials; no secrets for fork PRs; masking is not protection.`, r`Prevent cache poisoning: PR jobs read-only on trusted caches.`, r`Restrict runner egress to proxies and registries.`, r`Limit blast radius with scoped push rights and admission checks on release identity.`],
  ex: r`A compromised npm package in a PR build tried to exfiltrate tokens; the untrusted runner pool had no secrets and no internet egress except the package proxy, so the attempt failed and was flagged by egress logs.`,
  fu: [r`How would you safely run integration tests for external contributors?`, r`What is the risk of shared caches between branches?`],
  pit: [r`Long-lived runner VMs shared across teams.`, r`Exposing secrets to pull-request workflows.`, r`PR builds writing to caches used by release builds.`] },

{ id: 'q48', level: 'Principal', tags: ['startup-performance', 'scale-out', 'image-streaming', 'aot'],
  q: r`Your platform must scale a .NET API from 20 to 200 instances within two minutes during market open. Break down container start-up end to end and design how to hit the target.`,
  a: r`**Time budget, end to end**
1. **Scheduling decision** (autoscaler reacts to metrics): 15-60 s for metric-based scaling — use predictive/scheduled scaling for known peaks (market open is known).
2. **Node provisioning** if capacity is missing: 45-120 s for new VMs → keep **headroom** (overprovisioning balloon pods, warm pools) so pods land on existing nodes.
3. **Image pull**: size × bandwidth; 200 pods on 30 new nodes pulling 400 MB each through NAT can take minutes and hammer the registry.
4. **Container start**: runtime + .NET host start.
5. **App start**: JIT, DI graph construction, configuration/secret fetches (throttling risk: 200 pods calling a secrets service at once), connection pool establishment, cache warm-up.
6. **Readiness**: probes pass, endpoints propagate, load balancer registration (target health checks).

**Design to hit 2 minutes**
- **Trigger early**: scheduled scaling to 150+ at 07:55 for an 08:00 open; predictive scaling learned from history; reactive scaling only for the tail.
- **Capacity ready**: warm nodes (overprovisioning with negative-priority pods, warm pools of stopped instances), not cold VM launches.
- **Fast pulls**: small chiseled images with shared golden base layers (already cached on nodes), regional registry behind private endpoints, pre-pulled images on warm nodes (a DaemonSet that pulls the next release), lazy-loading snapshotters (SOCI, image streaming) for large images.
- **Fast app start**: ReadyToRun (or Native AOT where compatible), avoid heavy start-up work (lazy initialisation, no synchronous remote calls in constructors), cache secrets/config with jitter on fetch, pre-establish a minimum number of connections, warm critical caches asynchronously before readiness flips.
- **Readiness**: start-up probe tuned to real start time; readiness flips only when warm; LB health-check intervals short enough; readiness gates for LB registration.
- **Downstream**: ensure databases and dependencies tolerate 10x connections (connection limits, proxies such as RDS Proxy/PgBouncer, rate limiting).

**Measure and rehearse**: per-phase timing (pod scheduled → image pulled → container started → ready) from Kubernetes events/metrics; load tests that start from 20 instances and ramp; a pre-market checklist dashboard.`,
  code: r`~~~yaml
# Pre-pull the release image on all nodes of the pool before market open
apiVersion: apps/v1
kind: DaemonSet
metadata: { name: prepull-payments-api, namespace: platform-system }
spec:
  selector: { matchLabels: { app: prepull-payments-api } }
  template:
    metadata: { labels: { app: prepull-payments-api } }
    spec:
      nodeSelector: { node-pool: trading }
      initContainers:
        - name: pull
          image: registry.example/payments-api@sha256:9c1e...      # pulled into the node cache
          command: ["dotnet", "--info"]
      containers:
        - { name: pause, image: registry.k8s.io/pause:3.10, resources: { requests: { cpu: 1m, memory: 8Mi } } }
---
# Scheduled scale-up ahead of the open (KEDA cron trigger alongside load-based triggers)
apiVersion: keda.sh/v1alpha1
kind: ScaledObject
metadata: { name: payments-api, namespace: trading }
spec:
  scaleTargetRef: { name: payments-api }
  minReplicaCount: 20
  maxReplicaCount: 220
  triggers:
    - type: cron
      metadata: { timezone: Europe/London, start: "50 7 * * 1-5", end: "30 9 * * 1-5", desiredReplicas: "160" }
    - type: prometheus
      metadata: { serverAddress: http://prometheus.observability:9090, threshold: "40", query: "sum(rate(http_server_request_duration_seconds_count{service='payments-api'}[1m])) / count(up{service='payments-api'})" }
~~~`,
  dia: r`flowchart LR
  T[Trigger: scheduled 07:50 + load] --> N{Node capacity ready?}
  N -->|warm pool / balloons| P[Image already cached or small + regional]
  N -->|cold VM launch 60-120 s| SLOW[Too slow]
  P --> S[.NET start: ReadyToRun, lazy init, cached config]
  S --> W[Warm-up then readiness]
  W --> LB[LB registration via readiness gate]
  LB --> DB[(Downstream sized: proxy, connection limits)]`,
  pts: [r`Break start-up into trigger, capacity, pull, runtime, app warm-up and readiness.`, r`Known peaks: scheduled or predictive scaling, warm capacity.`, r`Small shared-layer images, regional registries, pre-pulling or lazy loading.`, r`ReadyToRun/AOT, lazy init, cached config with jitter, warm before ready.`, r`Protect downstream and rehearse with per-phase timing.`],
  ex: r`A brokerage met a 90-second scale-to-200 target by combining a 07:50 KEDA cron trigger, balloon-pod headroom, pre-pulled chiseled images and ReadyToRun; before, cold scaling took 6 minutes and missed the open.`,
  fu: [r`How do you avoid 200 pods simultaneously hitting the secrets service?`, r`When is Native AOT worth the compatibility cost for an API?`],
  pit: [r`Relying on reactive scaling for a known daily peak.`, r`Cold node launches in the critical path.`, r`Synchronous remote calls during start-up.`] },

{ id: 'q49', level: 'Principal', tags: ['standards', 'governance', 'templates', 'linting'],
  q: r`Establish Dockerfile and image standards across 40 teams without slowing them down: what goes into the standard, how it is delivered (templates, shared stages, SDK container publishing), how it is enforced (linting, policy), and how it evolves.`,
  a: r`**What the standard contains** (short, opinionated, rationale included)
- Approved base images (golden, digest-pinned) per stack and when to use each variant.
- Multi-stage structure with dependency-restore caching and BuildKit cache/secret mounts.
- Runtime rules: non-root ({{$APP_UID}}), exec-form entrypoint, port 8080, no shells in final images unless justified, no secrets in ENV/ARG/layers, read-only rootfs compatibility (write only to /tmp or volumes), stdout JSON logging, health endpoints, OCI labels (source, revision, owner).
- Size and start-up budgets per workload type.
- Supply chain: SBOM, provenance, signing, scanning thresholds.

**Delivery — make compliance the default**
- **Service templates** (Backstage/dotnet new templates) that generate a compliant Dockerfile, .dockerignore, compose file and pipeline.
- **Shared build logic**: reusable CI workflows/templates ("build-and-sign-image") so teams do not hand-roll pipelines; optional shared Dockerfile stages via a base build image.
- **SDK container publishing** ({{dotnet publish /t:PublishContainer}}) for standard ASP.NET Core services — no Dockerfile to maintain at all, chiseled non-root defaults; Dockerfiles only when needed.

**Enforcement — fast feedback first**
- Pre-commit/CI: **hadolint** with an org config (latest tags, root user, shell-form CMD, missing pins), secret scanning, image linting (Dockle), size check.
- Registry/admission: allowed registries, signatures, digests, non-root, no privileged — the backstop.
- Clear error messages linking to the standard and examples.

**Evolution**: the standard is versioned in Git with an RFC process; changes ship with migration tooling (automated PRs across repos — e.g. a codemod or Renovate preset); deprecation windows; a scorecard showing compliance per repo; exceptions time-bound.

**Measuring success**: % repos compliant, % images built via shared workflows, image age, build times, developer satisfaction — and fewer security findings from reviews.`,
  code: r`~~~yaml
# .hadolint.yaml (org-wide): fail builds on the patterns that cause incidents
failure-threshold: warning
ignored: []
override:
  error:
    - DL3007   # using latest
    - DL3002   # last USER should not be root
    - DL3025   # use JSON (exec form) for CMD/ENTRYPOINT
    - DL3006   # always tag the image explicitly
trustedRegistries:
  - registry.example
  - mcr.microsoft.com
label-schema:
  org.opencontainers.image.source: url
  org.opencontainers.image.revision: text
strict-labels: true
~~~
~~~yaml
# Reusable workflow call: teams get build, scan, SBOM, provenance and signing in three lines
jobs:
  image:
    uses: bank/platform-workflows/.github/workflows/dotnet-image.yml@v4
    with: { project: src/Payments.Api, image: payments-api, platforms: "linux/amd64,linux/arm64" }
~~~`,
  dia: r`flowchart LR
  STD[Versioned standard + RFC process] --> TPL[Service templates]
  STD --> WF[Reusable CI workflows]
  STD --> SDK[SDK container publish for standard apps]
  TPL --> REPO[Team repos]
  WF --> REPO
  REPO --> LINT[hadolint, secret scan, size check - fast feedback]
  LINT --> ADM[Registry + admission policies - backstop]
  ADM --> SCORE[Compliance scorecard]
  SCORE --> STD`,
  pts: [r`A short, opinionated standard with rationale: bases, structure, runtime rules, budgets, supply chain.`, r`Deliver via templates, reusable workflows and SDK container publishing.`, r`Enforce early with linting and scanning; admission policies as backstop.`, r`Version the standard; ship changes with automated migration PRs.`, r`Measure compliance, adoption, image age and developer satisfaction.`],
  ex: r`Replacing 40 hand-written pipelines with one reusable image workflow brought SBOMs and signatures to every service in a month and cut Dockerfile review comments by 80%.`,
  fu: [r`When should a team be allowed to diverge from the template?`, r`How do you roll out a new standard version across 200 repositories?`],
  pit: [r`Standards that exist only as wiki pages.`, r`Enforcement only at deploy time.`, r`No migration tooling when the standard changes.`] },

{ id: 'q50', level: 'Principal', tags: ['principles', 'summary'],
  q: r`Summarise the container principles you would enforce as Principal Engineer for a financial-services organisation.`,
  a: r`"My container principles fit on one page:

- **Containers package applications, not operating systems**: one process, minimal image, no state inside.
- **Golden, minimal, current bases**: chiseled .NET images, digest-pinned, rebuilt weekly, updated by automated PRs; image age is a tracked metric.
- **Build once, prove it, promote it**: multi-stage BuildKit builds with remote cache; tests against the built image; SBOM, provenance and signatures; the same digest moves from dev to prod.
- **Secrets never in images**: BuildKit secret mounts at build time; workload identity or secret stores at runtime.
- **Least privilege at runtime**: non-root, read-only rootfs, cap-drop ALL, no-new-privileges, seccomp; never privileged, never docker.sock; sandboxed runtimes for untrusted code.
- **Graceful by design**: exec-form entrypoints, SIGTERM handling within the platform grace period, health endpoints, stdout JSON logs, explicit resource limits matching .NET's GC behaviour.
- **Internal registries only**: mirrored upstream images, regional replication, immutable tags, CI-only push, admission-enforced.
- **Risk-based vulnerability management**: scan what runs, prioritise by exploitation and exposure, VEX, SLAs.
- **Right platform per workload**: managed container services by default, Kubernetes where justified, SPAs on CDNs, data in managed services, Windows containers only as a bridge.
- **Standards as code**: templates, reusable workflows, linting and policies, with evidence for auditors generated by the pipeline."`,
  code: r`~~~text
Images        : chiseled bases by digest, weekly rebuilds, Renovate PRs, image-age budget
Build         : multi-stage, BuildKit cache + secret mounts, remote cache, multi-arch where ARM
Trust         : SBOM + SLSA provenance + cosign/Notation, verified at admission
Secrets       : none in ENV/ARG/layers; workload identity, secret stores, mounted files
Runtime       : non-root 1654, read-only rootfs, cap-drop ALL, no-new-privileges, limits
Lifecycle     : exec-form ENTRYPOINT, SIGTERM drain, health endpoints, stdout JSON logs
Registries    : internal only, mirrored upstream, replicated, immutable, CI-only push
Vulns         : scan running workloads, KEV/EPSS/exposure priority, VEX, SLAs
Platforms     : managed container service default, Kubernetes by need, SPA on CDN
Governance    : templates, reusable workflows, hadolint, admission policies, scorecards
~~~`,
  pts: [r`Minimal, stateless, current images from golden bases.`, r`Build once, test the artefact, sign it, promote the digest.`, r`No secrets in images; least privilege at runtime.`, r`Graceful lifecycle, health, logs and limits by default.`, r`Internal registries, risk-based vulnerability management, right platform per workload, standards as code.`],
  ex: r`Encoding these principles in templates, reusable workflows and admission policies meant new services passed security review on day one and audit evidence came straight from the pipeline.`,
  fu: [r`Which principle would you enforce first in an estate with hundreds of legacy images?`],
  pit: [r`Principles without automation and policy behind them.`] }
],
cheat: r`### What a container is
Process + namespaces (pid, net, mnt, uts, ipc, user, cgroup) + cgroups v2 (cpu.max, memory.max, pids.max) + layered rootfs + seccomp/caps/AppArmor · shared host kernel (weaker boundary than VMs) · CLI → dockerd → containerd → shim → runc · OCI image/runtime/distribution specs · dockershim removal broke docker.sock users, not images.

### Images
Layers immutable, content-addressed; overlay2 copy-up on first write · deleting in later layers never shrinks · tags mutable, digests exact → deploy by digest · image index for multi-arch · order: base → manifests → restore → source → publish.

### Dockerfile for .NET
Multi-stage: sdk build → aspnet chiseled final · restore with csproj first + cache mount · secrets via --mount=type=secret · exec-form ENTRYPOINT · USER $APP_UID (1654) · port 8080 (ASPNETCORE_HTTP_PORTS) · -extra variant for ICU/tzdata · ReadyToRun / AOT for start-up · .dockerignore bin/obj/.git/.env · dotnet publish /t:PublishContainer as Dockerfile-less option.

### Runtime
Non-root, --read-only + tmpfs, --cap-drop=ALL, no-new-privileges, seccomp default · never --privileged or docker.sock · --memory (exit 137 = SIGKILL/OOM), --cpus (CFS throttling), --pids-limit · .NET heap limit 75% of memory limit; ProcessorCount from --cpus · PID 1: exec form handles SIGTERM; --init/tini for subprocesses; docker stop = SIGTERM, 10 s, SIGKILL.

### Networking & storage
User-defined bridge for name DNS (127.0.0.11) · localhost = the container itself · -p uses iptables DNAT, bypasses UFW → DOCKER-USER chain or bind 127.0.0.1 · watch MTU and address pools · volumes for data, bind mounts for dev, tmpfs for scratch · logs to stdout; rotate json-file or use local driver.

### Supply chain & registries
SBOM + SLSA provenance (buildx --sbom --provenance) + cosign/Notation signing, verified at admission · internal registries only, mirrored/pull-through upstream, immutable tags, CI-only push, regional replication, retention · rootless BuildKit/Buildah or VM runners in CI · scan running images, KEV/EPSS/exposure, VEX, SLAs · golden bases rebuilt weekly + Renovate.

### Debugging
ps / logs / inspect (OOMKilled) / stats / events · exit codes 1, 137, 139, 143 · debug container sharing PID+net namespaces for chiseled images · dotnet-counters (thread pool, GC), dotnet-trace, dotnet-dump/gcdump, dotnet-monitor triggers · reproduce with exact digest, --platform, limits, user, env.

### Say this
"A container is a process, not a VM." "Deploy digests, not tags." "Secrets never live in images." "docker.sock is root." "Exec form or no graceful shutdown." "Build once, sign it, promote the same digest."`
});
})(String.raw);
