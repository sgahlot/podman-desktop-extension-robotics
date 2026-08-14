# Physical AI

Podman Desktop extension for Physical AI robotics development. Provides a GUI-driven path from local development to container deployment for robotics engineers.

## Features

- **Image Catalog** — Browse and pull ROS2 images from Quay.io (All or Curated view; allowlist configurable in Preferences)
- **Image Builder** — Configure, build, and push ROS2 images (Humble TurtleBot3 or Jazzy sim + noVNC). Uses a [two-phase build](#two-phase-image-build): Phase 1 base, Phase 2 simulation. Builds and pushes are cancellable.
- **Simulation** — Launch Gazebo via Podman, open noVNC, add TurtleBot3 into a running world. Launch only allows images matching the simulation allowlist (default `ros2-*-sim*` / `ros2-*-turtlebot3`; optional exact tag/digest pins in Preferences). Local image content is trusted once selected — see Help → Image trust.
- **Help** — In-extension documentation

Current container bases are **Ubuntu interim** (official `ros` / OSRF / sloretz images). Fedora/RHEL migration is parked (APPENG-5809). Catalog lists **public** Quay repos only.

## Prerequisites

### Podman Desktop & Podman Machine

- **Podman Desktop** — 1.28+ (tested with 1.28.x and 1.29.x). Extension API `@podman-desktop/api@1.28.3`
- **Podman** — 5.x or 6.x (tested with 5.8.5 and 6.0.2)
- **Machine CPUs** — minimum 4, recommended 6+. Gazebo + noVNC; arm64 uses virtio-gpu by default.
- **Machine Memory** — minimum 4 GB, recommended 8 GB. Single sim container uses ~2.5–3 GB. Default ~5.7 GB works for 1–2 robots. Increase to 8 GB for 3+ robots.
- **Machine Disk** — minimum 30 GB, recommended 50+ GB. Base image ~1.5 GB, sim image ~3 GB, plus build cache layers.

To check or change Podman Machine resources: open **Settings → Resources → Podman Machine** in Podman Desktop (or use `podman machine set --memory 8192 --cpus 6`).

### Platform notes

- **Mac Apple Silicon (arm64)**: Use the **Local** Jazzy Quick Start — builds natively, no QEMU. VM backend is LibKrun (default). Simulation launch passes `/dev/dri` by default (virtio-gpu); see [GPU and rendering](#gpu-and-rendering).
- **OpenShift target (amd64)**: Use the **OpenShift** Quick Start (**TurtleBot3 Sim (Jazzy · amd64)**) — targets `amd64` (tagged `-amd64`) so the image is cluster-pullable. On an Apple Silicon host this cross-builds via QEMU emulation and is slower (expected).
- **Linux amd64**: Use Humble (sloretz or osrf base) or Jazzy (Noble or amd64 preset). Native GPU rendering may work but is untested.
- **Windows**: Untested.

## Getting Started

1. Install / load the extension in Podman Desktop
2. Open **Physical AI**, or press **F1** → **Physical AI: Open Dashboard**
3. **Image Builder** → Quick Start **Local** (**TurtleBot3 Sim (Jazzy)**) → Phase 1 Build → Phase 2 Build (use **OpenShift** for a cluster-pullable `amd64` image)
4. **Simulation** → Launch → Open in Browser → Add TurtleBot3 → optional **Navigate** (X/Y) and Topic Monitor **Peek**
5. **Stop & remove** when done — close the Gazebo (noVNC) browser tab manually if it is still open
6. Adjust defaults under **Settings → Preferences → Physical AI** (including **Simulation GPU passthrough** on Mac)

Idle noVNC tabs may show Disconnected; reconnect or refresh — the simulation is still running. Lidar/IMU topics are available after spawn when using a current sim image; **Navigate** on Jazzy sim uses Nav2 (`navigate_to_pose`) with obstacle-aware planning (Humble images still use open-loop `cmd_vel`).

## Settings

- **Default Namespace** — Quay.io namespace for catalog and image tags
- **Catalog view mode** — `all` (default) or `curated`
- **Catalog curated allowlist** — comma-separated repo name patterns (`*` wildcard), default `ros2-*-base,ros2-*-turtlebot3,ros2-*-sim*`
- **Simulation image allowlist** — optional comma-separated image refs or patterns for Simulation launch. Empty = default `ros2-*-sim*` / `ros2-*-turtlebot3`. Pin exact tags or `@sha256:…` digests for demos. Local image *content* is still trusted once selected.
- **Simulation GPU passthrough** — on arm64 Mac, pass `/dev/dri` into sim containers (default on). Disable to force software rendering (`llvmpipe`).
- **Topic peek timeout** — seconds to wait for Topic Monitor **Peek** (`ros2 topic echo --once`). Whole number 1–30; default 5.
- Image Builder wizard defaults (robot, distro, middleware, engine, base preset)

## Golden images to publish

Pre-built images to push to your Quay.io namespace so that users can pull and run without building locally. For a quick showcase, push just the Jazzy base + sim pair — users pull the sim image directly instead of building for ~20 minutes.

Build via Image Builder (or CLI against `assets/`), then push:

### Base images (Phase 1 outputs)

- `quay.io/<ns>/ros2-humble-base:sloretz` — Humble base built from sloretz's multi-arch desktop image. Works on Mac (arm64) and Linux (amd64).
- `quay.io/<ns>/ros2-humble-base:osrf` — Humble base built from the official OSRF image. amd64 only (Linux).
- `quay.io/<ns>/ros2-jazzy-base:latest` — Jazzy headless base for amd64. No GUI, for CI or headless ROS2 work.
- `quay.io/<ns>/ros2-jazzy-base:noble` — Jazzy base for arm64 (the Quick Start path). This is what Phase 1 produces on Mac.

### Simulation images (Phase 2 outputs, built on top of a base)

- `quay.io/<ns>/ros2-humble-turtlebot3:sloretz` — Humble TurtleBot3 sim (layers on the sloretz base).
- `quay.io/<ns>/ros2-jazzy-sim:noble` — The Jazzy sim: Gazebo + noVNC + Nav2 (launched on **Navigate** via `entrypoint-nav2.sh`).

## Coming Soon

- **Customize hardware** — Swap sensors on a running robot
- **Fleet** / **OpenShift Bridge** — Multi-robot scaling and deployment to OpenShift

## Packaging note

Bundled Containerfile contexts live under `assets/` in this package.

---

## Technical Notes

<a id="gpu-and-rendering"></a>

### GPU and rendering

On Mac, Podman Machine uses **LibKrun**. The host GPU is exposed to the Linux VM via **virtio-gpu** (API translation to Metal). Containers do **not** see `/dev/dri` unless the device is passed at launch.

**Default on Apple Silicon (arm64):** Simulation launch passes `/dev/dri/card0` and `/dev/dri/renderD128` and sets `PHYSICAL_AI_USE_GPU=1`. The entrypoint uses hardware rendering when `/dev/dri` is present; otherwise it falls back to `llvmpipe`. Disable under **Settings → Preferences → Physical AI → Simulation GPU passthrough** to always use software rendering.

On **amd64**, launch always forces `llvmpipe` (no GPU passthrough).

**In-cluster (OpenShift, amd64, no GPU):** software rendering additionally uses **off-screen EGL** for the Gazebo server (`--headless-rendering` + `EGL_PLATFORM=surfaceless`, backed by the `libgl1-mesa-dri` / `libegl-mesa0` / `libgbm1` packages). Without it, the sensors plugin's Ogre2/GL3Plus tries to open an on-screen GLX window under llvmpipe and **segfaults** the pod on robot spawn. The noVNC GUI still renders on the Xvfb display; only the server's sensor rendering goes through EGL. Do not remove the headless flag or the mesa-EGL packages without re-testing on an amd64 cluster.

**In-cluster CPU sizing (no GPU):** software rendering is CPU-bound — the `gz sim -g` GUI client alone needs ~2.3 cores to render the scene for noVNC, and during *active* Nav2 navigation the planner/controller/costmaps add ~1 more. On a 2-core pod the sim's real-time factor collapses to ~0.1 (goals never finish); at 4 cores goals complete but active-nav utilization hits ~90%, so RTF sags to ~0.3–0.6 and motion is slow and jerky. The software-rendering Deployment therefore requests **6 guaranteed CPUs** (`requests == limits`), which keeps utilization ~60% with headroom so navigation runs at ~real-time (RTF ~1.0, a warm ~2 m trip in ~33 s). The bottleneck is the GUI (not the depth camera), so dropping sensors doesn't lower the requirement — a GPU does. A residual micro-stutter can remain because the container sees all host CPUs but is CFS-throttled to 6 (Gazebo/Ogre size thread pools to the visible count); a GPU or thread-capping removes it.

**In-cluster with a GPU (OpenShift + NVIDIA GPU operator):** the **Deploy to OpenShift** page has a **"Cluster has a GPU"** toggle. When on, the Deployment requests `nvidia.com/gpu: 1` and sets `PHYSICAL_AI_USE_GPU=1` (dropping the software-rendering env), and the CPU ask drops back to 2 (the GPU does the rendering). The entrypoint then sees a GPU request without `/dev/dri` (the GPU operator exposes `/dev/nvidia*`, not DRI) and renders the server off-screen via **hardware EGL** (`--headless-rendering`, no `surfaceless`/llvmpipe override). This path is **implemented but not yet verified** — no GPU cluster was available to test. The default (toggle off) is the tested software path above.

**Ogre2 Sensors (2026-08 re-verification):** The `gz-sim-sensors-system` plugin no longer segfaults on current Gazebo Harmonic + Mesa (llvmpipe or virtio-gpu). It is re-enabled in `tb3_sandbox.sdf.xacro`. Lidar (`/scan`) and IMU topics are available after spawn.

On **Linux with a native GPU** (not in a VM), Ogre2 may work without these workarounds, **but this has not been tested.**

### Single container architecture

The simulation runs everything in a single Podman container (not a pod). The original plan used separate containers in a pod for ROS2, Gazebo, and noVNC. On Mac Apple Silicon, the combined memory pressure of the pod-based setup caused Nav2 to OOMKill at 4 GiB. A single container with all components baked in eliminates infra container overhead and fits within the default Podman Machine (~5.7 GB).

Robots are added to the running container via `podman exec` (not by starting additional containers).

### Two-phase image build

The Image Builder splits the build into a base image (Phase 1) and a simulation image (Phase 2) that layers on top via `FROM $LOCAL_BASE_IMAGE`. This is a practical optimization:

- **Build speed** — The base (ROS2 core, ~1–2 GB of apt packages) rarely changes. Sim layer rebuilds take ~5 min vs ~15–20 min for the full stack.
- **Shared foundation** — Multiple sim images share the same base (Humble TurtleBot3, Jazzy sim, future robot types).
- **Smaller pushes** — If the base is already on Quay, only the sim diff layers are transferred.
- **Non-simulation use** — The base image works standalone for headless ROS2 development or CI.
