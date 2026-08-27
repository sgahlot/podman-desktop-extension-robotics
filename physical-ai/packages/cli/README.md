# physical-ai-cli

A standalone CLI for Physical AI robotics development — build ROS2 images, launch Gazebo
simulations, and spawn robots, **without installing Podman Desktop**. It reuses the same
business logic as the [Physical AI Podman Desktop extension](../backend/README.md), talking
directly to the `podman` CLI instead of going through Podman Desktop's extension API.

This is a **prototype covering a representative slice** — build, launch, and spawn — not full
parity with the extension yet. See [Scope and limitations](#scope-and-limitations) below for
exactly what is and isn't implemented today.

## Prerequisites

| Requirement | Version |
|---|---|
| Node.js (to build the CLI) | ≥ 24.0.0 |
| Podman | 5.x or 6.x (tested with 6.0.2) — must be installed and running |

> **Why Node ≥24 is a hard floor, not just a version match:** this package is built as
> CommonJS, but its `listr2` dependency (used for `build:*`'s progress output) ships **ESM
> only** — no CJS build. Loading it via `require('listr2')` only works because Node added
> synchronous `require(esm)` support, which became stable (unflagged) in **Node 22.12** and
> is present in Node 24. If this package's `engines.node` requirement is ever lowered below
> that, `build:base`/`build:sim`/`build:file` will fail immediately with `ERR_REQUIRE_ESM` for
> anyone on an older Node — silently, with no earlier warning from `npm install` or
> `engines` enforcement beyond whatever floor is declared at the time. Keep this in mind
> before relaxing the Node requirement for this package specifically.

Unlike the extension, this CLI has no notion of Podman Desktop's provider/connection registry —
every command runs `podman` directly. `podman info` must succeed on your machine before any
build/launch/spawn command will work; each command checks this up front and fails fast with a
clear error if it doesn't.

## Install / build

From the repo root:

```bash
npm install
npm run build -w packages/cli
```

This compiles TypeScript to `packages/cli/dist/` and copies the bundled Containerfile build
contexts from `packages/backend/assets/` into `packages/cli/assets/` (needed by `build:base`
and `build:sim`, which — like the extension's Image Builder — build from a bundled context
rather than one you supply).

Run it directly:

```bash
./packages/cli/bin/run.cjs --help
```

Or put `physical-ai` on your `PATH`:

```bash
npm link -w packages/cli
physical-ai --help
```

Every command example below uses `physical-ai`; substitute `./packages/cli/bin/run.cjs` if you
didn't `npm link`.

## Commands

Run `physical-ai <command> --help` for the full flag list plus worked `EXAMPLES` for that
command; what follows here is the quick reference.

### Build output

`build:base`, `build:sim`, and `build:file` run as a small task list (via
[Listr2](https://listr2.kilic.dev)) rather than dumping the full `podman build` log straight
into your terminal: each step collapses to a spinner + title, with only the last 8 lines of
`podman build`'s output visible in a scrolling window underneath — closer to how Gradle/npm
show build progress. On success the output collapses back down to just a checkmark; on failure
the real error (e.g. an actual `apt`/build failure line, not just an exit code) is always shown
in full, regardless of how the progress UI rendered. This only applies in an interactive
terminal; piped or non-TTY output (CI logs, `| tee build.log`, etc.) automatically falls back to
printing every line in full.

`build:base` and `build:sim` also print a one-line config summary before the build starts —
`robot · distro · middleware · engine · base-image · target-arch` — mirroring the extension's
Image Builder Pipeline summary line. It's plain terminal output printed before the progress UI
starts, so it stays in your scrollback after the command finishes; this is what actually
resolved when using `--quickstart`, since that flag hides the individual values it sets. For
`build:sim`, target arch isn't known until it's inspected from `--base-tag`, so it's surfaced
via the "Resolving architecture of ..." step's own title instead of the upfront summary line.

### `build:base` — build the ROS2 base image (Phase 1)

```bash
physical-ai build:base --tag quay.io/<ns>/ros2-humble-base:sloretz
```

| Flag | Required | Default | Notes |
|---|---|---|---|
| `--tag` | yes | — | Full image tag to build |
| `--quickstart` | no | — | `arm64` \| `amd64` — applies the extension's Quick Start preset (below) for this architecture; mutually exclusive with all the profile flags below |
| `--robot` | no | `turtlebot3` | Robot type |
| `--distro` | no | `humble` | `humble` \| `jazzy` |
| `--middleware` | no | `dds` | `dds` \| `zenoh` |
| `--engine` | no | `gazebo` | Simulation engine |
| `--base-image` | no | depends on `--distro` | `sloretz` \| `osrf` \| `jazzy` \| `jazzy-noble` |
| `--target-arch` | no | detected host arch | `amd64` \| `arm64` — always resolves to a concrete value and is always passed to `podman build --platform`, rather than silently deferring to whatever the container runtime picks when unset |

`--robot`/`--distro`/`--middleware`/`--engine` aren't free-form — they're matched as an exact
4-tuple against a fixed list of "known-good" profiles, each backed by a real bundled Containerfile.
Only `humble/turtlebot3/dds/gazebo`, `jazzy/turtlebot3/dds/gazebo`, and
`jazzy/turtlebot3/zenoh/gazebo` currently resolve (the two Jazzy combinations share the same
Jazzy base assets — middleware is a runtime choice there, not a build-time one). Anything else
(wrong robot, wrong engine, an unsupported distro+middleware pairing, etc.) fails fast with a
clear "No base image profile for ..." error instead of attempting a build against a Containerfile
that doesn't exist.

Also validated: `--base-image` must actually be available for the selected `--distro` (checked
against the same per-distro filter the extension's Base image dropdown uses) —
`--distro humble --base-image jazzy-noble` is rejected upfront rather than silently building a
"humble"-tagged image from the Jazzy upstream image.

#### `--quickstart` — matches the extension's Quick Start button

```bash
physical-ai build:base --quickstart arm64 --tag quay.io/<ns>/ros2-jazzy-base:noble
physical-ai build:base --quickstart amd64 --tag quay.io/<ns>/ros2-jazzy-base:noble-amd64
```

Mirrors the extension's Image Builder "Quick Start" preset exactly: `robot=turtlebot3`,
`distro=jazzy`, `middleware=dds`, `engine=gazebo`, `base-image=jazzy-noble` (the multi-arch
"Ubuntu 24.04 Noble" preset). The `<arm64|amd64>` value plays the role of the extension's
separate "Target" toggle (This machine / amd64 for OpenShift) — in the UI those two controls
are independent, but for a CLI flag it's more natural to fold "apply the preset" and "for this
arch" into one switch. Building for a different arch than your host uses QEMU emulation and
will be slower — a note is printed when that's the case, matching the extension's own info
banner. `--tag` is never auto-generated or suffixed — you always provide it explicitly, same as
every other command.

### `build:sim` — build the simulation image (Phase 2)

```bash
physical-ai build:sim --tag quay.io/<ns>/ros2-humble-turtlebot3:sloretz \
  --base-tag quay.io/<ns>/ros2-humble-base:sloretz
```

| Flag | Required | Default | Notes |
|---|---|---|---|
| `--tag` | yes | — | Full image tag to build for the sim image |
| `--base-tag` | yes | — | Tag of an already-built base image to layer this on — must resolve locally via `podman` (i.e. built by `build:base`/`build:file` first, or already pulled) |
| `--quickstart` | no | — | Boolean — applies the extension's Quick Start preset (same as `build:base --quickstart`, minus the arch, since arch here comes from `--base-tag`); mutually exclusive with `--robot`/`--distro`/`--middleware`/`--engine` |
| `--robot` | no | `turtlebot3` | Robot type |
| `--distro` | no | `humble` | `humble` \| `jazzy` |
| `--middleware` | no | `dds` | `dds` \| `zenoh` |
| `--engine` | no | `gazebo` | Simulation engine |

There is no `--target-arch` flag here: `build:sim` inspects `--base-tag`'s actual architecture
via `podman image inspect` and always builds the sim layer for that same architecture. This is
deliberate — building a sim image for a different arch than its own base wouldn't work, so
letting the two be specified independently would just be a second place for them to drift out
of sync (this is also what caused an earlier build failure — see
[Scope and limitations](#scope-and-limitations) for the actual root cause found while fixing
this, tracked separately in APPENG-6071).

`--tag` is the tag the **sim** image will be built as — it has no bearing on which base image
gets used. `--base-tag` is what controls that, and must point at a tag that already exists in
your local `podman` image store (built via `build:base`, or pulled). Earlier versions of this
command took a `--namespace` flag and tried to reconstruct the expected base image tag itself —
that was dropped because it required exact tag-matching across two separate commands with no
shared state, and a mismatch could silently trigger an unintended pull from Quay.

### `build:file` — build from an existing Containerfile

```bash
physical-ai build:file --tag localhost/my-image:latest \
  --context-dir ./my-build-context --containerfile Containerfile
```

| Flag | Required | Default | Notes |
|---|---|---|---|
| `--tag` | yes | — | Image tag to build |
| `--context-dir` | yes | — | Directory containing the Containerfile (the build context) |
| `--containerfile` | no | `Containerfile` | Name, relative to `--context-dir` |
| `--platform` | no | — | e.g. `linux/amd64` |
| `--build-arg` | no | none | `KEY=VALUE`, repeatable — needed for Containerfiles with a required `ARG` (e.g. the sim images' `LOCAL_BASE_IMAGE`, which has no default) |

Unlike the extension's Layer Composer (which accepts pasted Containerfile text and writes it to
a throwaway temp dir), this takes a real directory already on disk — the natural shape for CLI
use. SBOM generation is not ported (see [Scope and limitations](#scope-and-limitations)).

### `sim:launch` — launch a simulation container

```bash
physical-ai sim:launch --image quay.io/<ns>/ros2-humble-turtlebot3:sloretz
```

Prints the new container id on success.

| Flag | Required | Default | Notes |
|---|---|---|---|
| `--image` | yes | — | Image tag to launch |
| `--name` | no | auto-generated | Container name |
| `--port` | no | `6080:6080/tcp`, `8080:8080/tcp` | `hostPort:containerPort[/tcp\|udp]`, repeatable |
| `--env` | no | none | `KEY=VALUE`, repeatable — allowlisted keys only |
| `--gpu` / `--no-gpu` | no | on for arm64 host, off otherwise | GPU device passthrough |

The container command is always the sim entrypoint (matching the extension's own restriction) —
there is no `--cmd` escape hatch.

### `sim:list` — list simulation containers

```bash
physical-ai sim:list
physical-ai sim:list --format json
```

| Flag | Required | Default | Notes |
|---|---|---|---|
| `--format` | no | `table` | `table` \| `json` |

Lists containers by the same simulation label the extension uses, so containers launched from
either the extension or the CLI show up here.

### `sim:spawn` — spawn a robot into a running simulation

```bash
physical-ai sim:spawn <container-id> --robot robot1 --x 0 --y 0 --yaw 0
```

| Arg/Flag | Required | Notes |
|---|---|---|
| `CONTAINER_ID` (positional) | yes | Container id or unambiguous prefix |
| `--robot` | yes | Robot name |
| `--x` / `--y` | yes | Spawn position |
| `--yaw` | yes | Spawn yaw, radians |

Note: the extension's Nav2 pre-warm side effect for Jazzy images is **not** ported here — see
[Scope and limitations](#scope-and-limitations).

### `sim:stop` — stop a running simulation container

```bash
physical-ai sim:stop <container-id>
```

## End-to-end example

`sim:launch` needs a **simulation** image (Gazebo + noVNC), not the base image — the base image
alone has no sim entrypoint:

```bash
# Phase 1: base image
physical-ai build:base --tag quay.io/<ns>/ros2-humble-base:local

# Phase 2: simulation image, explicitly layered on the base image above via --base-tag
physical-ai build:sim --tag quay.io/<ns>/ros2-humble-turtlebot3:local \
  --base-tag quay.io/<ns>/ros2-humble-base:local

# Launch the SIM image (not the base image), spawn, list, stop
physical-ai sim:launch --image quay.io/<ns>/ros2-humble-turtlebot3:local
physical-ai sim:list
physical-ai sim:spawn <container-id> --robot robot1 --x 0 --y 0 --yaw 0
physical-ai sim:stop <container-id>
```

`build:file --build-arg` (see above) covers the same case if you'd rather build from a
Containerfile directly instead of going through `build:sim`'s robot/distro/middleware profile
resolution.

## Scope and limitations

This CLI ports **build + launch + spawn** — a representative slice proving the adapter pattern,
not full parity with the extension. Explicitly **not yet implemented**:

- OpenShift / Kubernetes commands (deploy, context resolution, workload status, delete)
- ROS topic peek and navigation-goal commands
- The Nav2 pre-warm side effect the extension triggers on spawn for Jazzy images
- Image catalog / registry browsing (`listCatalogImages`, `pullImage`, `pushImage`, build
  history, SBOM generation)
- Host-preference config get/set (default namespace, catalog view mode, GPU-passthrough default,
  etc.) — this CLI uses explicit flags with sensible defaults instead of a config file
- Image-builder layer-composition wizard parity (SBOM options on `build:file`)
- `deleteSimulation`, `openSimulationInBrowser`, `openUrlInBrowser`
- Build cancellation / progress polling — a CLI invocation is a single foreground process;
  `Ctrl+C` is the cancel mechanism

Later work will port the remaining methods from the extension's `PhysicalAiApi` interface as
additional command topics (`catalog:*`, `config:*`, `openshift:*`, `ros:*`).

**Known issue — Humble sim image build:** `build:sim --distro humble` can fail with
`E: Unable to locate package ros-humble-ros-gz` on some Ubuntu/arch combinations (reproduced on
arm64). This is a package-availability issue in the bundled `ros2-humble-turtlebot3`
Containerfile itself, not something introduced by this CLI — the extension would hit the same
failure building this same profile. Tracked under the Humble/Jazzy parity work in APPENG-6071.
Jazzy sim builds (`--distro jazzy`) are unaffected.

## Troubleshooting

**"No running Podman connection" / preflight failure** — run `podman info` yourself and resolve
whatever it reports (Podman machine not started, socket not reachable, etc.) before retrying.

**`build:sim` fails to resolve `LOCAL_BASE_IMAGE`** — the tag passed to `--base-tag` doesn't
exist in your local `podman` image store (and podman couldn't pull it from a registry either).
Run `podman images` to check, or build/pull the base image first.

**A container launched by the extension doesn't show up in `sim:list`, or vice versa** — both
share the same container label, so this would indicate a real bug — please report it.

## Development

```bash
npm run typecheck:cli   # from repo root
npm run test:cli
npm run lint:check      # repo-wide, includes packages/cli
npm run format:check    # repo-wide, includes packages/cli
```

Source layout: `src/commands/**` are the oclif command definitions (thin — flag parsing plus a
call into the adapter layer); `src/lib/podman/**` is the adapter layer that shells out to
`podman` (the direct replacement for the extension's `containerEngine.*`/`process.exec` calls);
`src/lib/assets.ts` resolves the bundled build-context directories. Security-relevant input
validation (`assertSpawnExecCommand`, `assertLaunchCmd`, etc.) is imported directly from
`packages/shared/src/security/simInput.ts`, unmodified from the extension.
