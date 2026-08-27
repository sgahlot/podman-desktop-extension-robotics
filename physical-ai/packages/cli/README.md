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
show build progress. This only applies in an interactive terminal; piped or non-TTY output
(CI logs, `| tee build.log`, etc.) automatically falls back to printing every line in full.

### `build:base` — build the ROS2 base image (Phase 1)

```bash
physical-ai build:base --tag quay.io/<ns>/ros2-humble-base:sloretz
```

| Flag | Required | Default | Notes |
|---|---|---|---|
| `--tag` | yes | — | Full image tag to build |
| `--robot` | no | `turtlebot3` | Robot type |
| `--distro` | no | `humble` | `humble` \| `jazzy` |
| `--middleware` | no | `dds` | `dds` \| `zenoh` |
| `--engine` | no | `gazebo` | Simulation engine |
| `--base-image` | no | depends on `--distro` | `sloretz` \| `osrf` \| `jazzy` \| `jazzy-noble` |
| `--target-arch` | no | host arch | `amd64` \| `arm64` — cross-build target |

Only `humble/turtlebot3/dds/gazebo` and `jazzy/turtlebot3/dds/gazebo` profiles currently resolve
to a real build context; other combinations fail with a clear "no profile" error.

### `build:sim` — build the simulation image (Phase 2)

```bash
physical-ai build:sim --tag quay.io/<ns>/ros2-humble-turtlebot3:sloretz
```

Same config flags as `build:base`, plus:

| Flag | Required | Default | Notes |
|---|---|---|---|
| `--namespace` | no | `ecosystem-appeng` | Quay namespace the base image is expected under |

**Important:** `build:sim` does not take the base image tag directly — it reconstructs the
expected base image reference from `--namespace` + the resolved profile (mirroring how the
extension's Phase 2 build locates Phase 1's output). If you haven't pushed a matching base image
to that Quay namespace, the build will fail when Podman can't resolve `LOCAL_BASE_IMAGE`. For a
build that doesn't depend on Quay at all, use `build:file` instead (below).

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

```bash
# Phase 1: base image
physical-ai build:base --tag localhost/ros2-humble-base:local

# Skip Phase 2's Quay dependency for a local smoke test — build straight from the bundled
# sim context instead:
physical-ai build:file --tag localhost/ros2-humble-sim:local \
  --context-dir packages/cli/assets/ros2-humble-turtlebot3

# Launch, spawn, list, stop
physical-ai sim:launch --image localhost/ros2-humble-sim:local
physical-ai sim:list
physical-ai sim:spawn <container-id> --robot robot1 --x 0 --y 0 --yaw 0
physical-ai sim:stop <container-id>
```

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

## Troubleshooting

**"No running Podman connection" / preflight failure** — run `podman info` yourself and resolve
whatever it reports (Podman machine not started, socket not reachable, etc.) before retrying.

**`build:sim` fails to resolve `LOCAL_BASE_IMAGE`** — see the `build:sim` note above; either push
a matching base image to the expected Quay namespace/tag, or use `build:file` for a build that
doesn't depend on a remote base image.

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
