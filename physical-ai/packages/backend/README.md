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
- **Machine CPUs** — minimum 4, recommended 6+. Gazebo + Nav2 + noVNC are CPU-bound under software rendering.
- **Machine Memory** — minimum 4 GB, recommended 8 GB. Single sim container uses ~2.5–3 GB. Default ~5.7 GB works for 1–2 robots. Increase to 8 GB for 3+ robots.
- **Machine Disk** — minimum 30 GB, recommended 50+ GB. Base image ~1.5 GB, sim image ~3 GB, plus build cache layers.

To check or change Podman Machine resources: open **Settings → Resources → Podman Machine** in Podman Desktop (or use `podman machine set --memory 8192 --cpus 6`).

### Platform notes

- **Mac Apple Silicon (arm64)**: Use the Jazzy Quick Start — builds natively, no QEMU. VM backend is LibKrun (default). Uses software rendering (llvmpipe) — see [GPU and rendering](#gpu-and-rendering) for why.
- **Linux amd64**: Use Humble (sloretz or osrf base) or Jazzy (Noble or amd64 preset). Native GPU rendering may work but is untested.
- **Windows**: Untested.

## Getting Started

1. Install / load the extension in Podman Desktop
2. Open **Physical AI**, or press **F1** → **Physical AI: Open Dashboard**
3. **Image Builder** → Quick Start **TurtleBot3 Sim (Jazzy)** → Phase 1 Build → Phase 2 Build
4. **Simulation** → Launch → Open in Browser → Add TurtleBot3 → optional **Go** (X/Y) and Topic Monitor **Peek**
5. **Stop** when done — close the Gazebo (noVNC) browser tab manually if it is still open
6. Adjust defaults under **Settings → Preferences → Physical AI**

Idle noVNC tabs may show Disconnected; reconnect or refresh — the simulation is still running. Sensors (lidar/camera) are off under software rendering on Mac, so **Go** has no obstacle avoidance.

## Settings

- **Default Namespace** — Quay.io namespace for catalog and image tags
- **Catalog view mode** — `all` (default) or `curated`
- **Catalog curated allowlist** — comma-separated repo name patterns (`*` wildcard), default `ros2-*-base,ros2-*-turtlebot3,ros2-*-sim*`
- **Simulation image allowlist** — optional comma-separated image refs or patterns for Simulation launch. Empty = default `ros2-*-sim*` / `ros2-*-turtlebot3`. Pin exact tags or `@sha256:…` digests for demos. Local image *content* is still trusted once selected.
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
- `quay.io/<ns>/ros2-jazzy-sim:noble` — The Jazzy sim: Gazebo + Nav2 + noVNC.

## Coming Soon

- **Customize hardware** — Swap sensors on a running robot
- **Fleet** / **OpenShift Bridge** — Multi-robot scaling and deployment to OpenShift

## Packaging note

Bundled Containerfile contexts live under `assets/` in this package.

---

## Technical Notes

<a id="gpu-and-rendering"></a>

### GPU and rendering

Podman Machine on Mac (LibKrun) does expose GPU virtualization via virtio-gpu/virgl — "Default GPU enabled (LibKrun)" is shown in Podman Desktop. However, Gazebo's Ogre2 rendering engine does not work reliably through this virtualization layer on arm64: the Sensors system plugin (`GL3PlusRenderSystem`) segfaults when using virgl or any non-llvmpipe Mesa driver.

We force software rendering instead:
- `LIBGL_ALWAYS_SOFTWARE=1` — tells Mesa to skip hardware GPU detection
- `GALLIUM_DRIVER=llvmpipe` — selects the LLVM-based CPU rasterizer

This is stable and sufficient at 1024x768. Gazebo visuals and physics work normally; only simulated sensor data (camera images, depth maps) is unavailable because the Sensors plugin was removed from the world SDF to avoid the segfault.

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
