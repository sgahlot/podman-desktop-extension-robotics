# Physical AI

Podman Desktop extension for Physical AI robotics development. Provides a GUI-driven path from local development to container deployment for robotics engineers.

## Features

- **Image Catalog** — Browse and pull ROS2 images from Quay.io (All or Curated view; allowlist configurable in Preferences)
- **Image Builder** — Two-phase configure / build / push: Phase 1 base, Phase 2 simulation (Humble TurtleBot3 or Jazzy arm64 sim + noVNC). Cancel works for both build and push. Registry tag presence is shown for public Quay tags. The two-phase split is a build optimization — the base image (ROS2 core) rarely changes, so rebuilding only the sim layer is much faster. Multiple sim images can share the same base. See the design doc for details.
- **Simulation** — Launch Gazebo via Podman, open noVNC, add TurtleBot3 into a running world
- **Help** — In-extension documentation

Current container bases are **Ubuntu interim** (official `ros` / OSRF / sloretz images). Fedora/RHEL migration is parked (APPENG-5809). Catalog lists **public** Quay repos only.

## Prerequisites

### Podman Desktop & Podman Machine

- **Podman Desktop** — 1.28+ (recommended: latest). Extension API `@podman-desktop/api@1.28.3`
- **Podman** — 5.x (recommended: 5.8+, tested with 5.8.5)
- **Machine CPUs** — minimum 4, recommended 6+. Gazebo + Nav2 + noVNC are CPU-bound under software rendering.
- **Machine Memory** — minimum 4 GB, recommended 8 GB. Single sim container uses ~2.5–3 GB. Default ~5.7 GB works for 1–2 robots. Increase to 8 GB for 3+ robots.
- **Machine Disk** — minimum 30 GB, recommended 50+ GB. Base image ~1.5 GB, sim image ~3 GB, plus build cache layers.

To check or change Podman Machine resources: open **Settings → Resources → Podman Machine** in Podman Desktop (or use `podman machine set --memory 8192 --cpus 6`).

### Platform notes

- **Mac Apple Silicon (arm64)**: Use the Jazzy arm64 Quick Start — builds natively, no QEMU. VM backend is LibKrun (default). Software rendering via llvmpipe (no GPU passthrough in Podman VM).
- **Linux amd64**: Use Humble (sloretz or osrf base) or Jazzy (amd64 preset). GPU passthrough may be possible but is untested.
- **Windows**: Untested.

## Getting Started

1. Install / load the extension in Podman Desktop
2. Open **Physical AI**, or press **F1** → **Physical AI: Open Dashboard**
3. **Image Builder** → Quick Start **TurtleBot3 Sim (Jazzy arm64)** → Phase 1 Build → Phase 2 Build
4. **Simulation** → Launch → Open in Browser → Add TurtleBot3
5. Adjust defaults under **Settings → Preferences → Physical AI**

## Settings

- **Default Namespace** — Quay.io namespace for catalog and image tags
- **Catalog view mode** — `all` (default) or `curated`
- **Catalog curated allowlist** — comma-separated repo name patterns (`*` wildcard), default `ros2-*-base,ros2-*-turtlebot3,ros2-*-sim-*`
- Image Builder wizard defaults (robot, distro, middleware, engine, base preset)

## Golden images to publish (demo / personal Quay)

Build via Image Builder (or CLI against `assets/`), then push:

- **Mac / multi-arch Humble base** — `quay.io/<ns>/ros2-humble-base:sloretz`
- **Linux amd64 Humble base** — `quay.io/<ns>/ros2-humble-base:osrf`
- **Jazzy headless base (amd64)** — `quay.io/<ns>/ros2-jazzy-base:latest`
- **Jazzy base (arm64 Quick Start)** — `quay.io/<ns>/ros2-jazzy-base:noble`
- **Humble sim (FROM sloretz base)** — `quay.io/<ns>/ros2-humble-turtlebot3:sloretz`
- **Jazzy sim + noVNC (arm64)** — `quay.io/<ns>/ros2-jazzy-sim-arm64:noble`

## Coming Soon

- **Customize hardware** — Swap sensors on a running robot (Story 6 stretch)
- **Fleet** / **OpenShift Bridge** (stretch; Kind path parked)

## Packaging note

Bundled Containerfile contexts live under `assets/` in this package.
