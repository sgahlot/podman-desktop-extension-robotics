# Physical AI

Podman Desktop extension for Physical AI robotics development. Provides a GUI-driven path from local development to container deployment for robotics engineers.

## Features

- **Image Catalog** — Browse and pull ROS2 images from Quay.io (All or Curated view; allowlist configurable in Preferences)
- **Image Builder** — Configure, build, and push ROS2 images (Jazzy sim + noVNC; Humble exists but is not currently verified working — see Coming Soon). Uses a [two-phase build](#two-phase-image-build): Phase 1 base, Phase 2 simulation. Builds and pushes are cancellable. A **Layers** layout is also available to compose a custom image from Base OS / hardened app / ROS / simulation layers, with a live compatibility verdict as you pick — see [Hummingbird support](#hummingbird-support) and Help → Image Builder.
- **Simulation** — Launch Gazebo via Podman, open noVNC, add TurtleBot3 into a running world. Launch only allows images matching the simulation allowlist (default `ros2-*-sim*` / `ros2-*-turtlebot3`; optional exact tag/digest pins in Preferences). Local image content is trusted once selected — see Help → Image trust. A **Show Viewer** toggle next to **Open in Browser** embeds the noVNC canvas inline in the panel, no browser tab needed (APPENG-6283).
- **OpenShift Deployment** — Deploy a pushed `amd64` image to an OpenShift cluster from the Simulation page's **OpenShift** tab: pick a namespace/context, preview generated manifests, Deploy, Open URL. Lists deployed sims with per-robot spawn/navigate/remove, delete/refresh, a **Cluster has a GPU** toggle, an optional [Hummingbird](#hummingbird-support) nginx sidecar demo, and the same inline **Show Viewer** toggle as local Simulation, over the route.
- **Diagnostics** — Live diagnostics for spawned robots (local or OpenShift), deep-linkable via URL query params (`target=`, `containerId=`/context, `robot=`).
- **Help** — In-extension documentation

Current container bases are **Ubuntu interim** (official `ros` / OSRF / sloretz images). Fedora/RHEL migration is parked (APPENG-5809). Catalog lists **public** Quay repos only.

<a id="hummingbird-support"></a>

### Hummingbird support

- The **Layers** image-builder layout can pull Hummingbird hardened-app images as optional layers — *companions* (pulled and run alongside) or *tools* (baked in via `COPY --from`). Install the `redhat.hummingbird` extension (and `redhat.bootc` for the bootc bases) to pull those images.
- The **OpenShift** deploy tab has a **Hummingbird nginx sidecar** checkbox that adds a `registry.access.redhat.com/hi/nginx` companion container to the pod, reverse-proxying noVNC through it, to demonstrate the companion-image pattern live (APPENG-6227).

## Screenshots

![Quick Start: build, launch, and view the simulation inline](https://raw.githubusercontent.com/sgahlot/podman-desktop-extension-robotics/main/physical-ai/docs/img/quick-start-show-viewer.gif)

Quick Start — Image Builder page: Phase 1/Phase 2 build → Simulation page: Launch → **Show Viewer** (embedded inline, no browser tab) → Add TurtleBot3.

![Image Catalog: browse and pull an image](https://raw.githubusercontent.com/sgahlot/podman-desktop-extension-robotics/main/physical-ai/docs/img/image-catalog-pull.gif)

Image Catalog — browse a Quay.io namespace and pull a pre-built image instead of building locally.

![OpenShift: deploy and view the simulation inline over the route](https://raw.githubusercontent.com/sgahlot/podman-desktop-extension-robotics/main/physical-ai/docs/img/openshift-deploy-show-viewer.gif)

OpenShift tab — Deploy → preview manifests → Deploy → **Show Viewer**, rendering inline over the cluster's route.

![Show Viewer toggle: embed the simulation inline](https://raw.githubusercontent.com/sgahlot/podman-desktop-extension-robotics/main/physical-ai/docs/img/show-viewer-toggle.gif)

**Show Viewer** (Simulation page, local or OpenShift) — toggle the embedded noVNC canvas on and off inline in the panel, no browser tab needed.

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
- **OpenShift target (amd64)**: Use the **OpenShift** Quick Start (**TurtleBot3 Sim (Jazzy · amd64)**) — targets `amd64` (tagged `-amd64`) so the image is cluster-pullable. On an Apple Silicon host this cross-builds via QEMU emulation and is slower (expected). The in-cluster GPU rendering path (server + GUI, via NVIDIA headless EGL / VirtualGL) has been validated live on a real GPU cluster for a single robot — see [GPU and rendering](#gpu-and-rendering).
- **Linux amd64**: Use the **Jazzy** Quick Start. Humble base/sim images exist under `assets/` but are **not currently verified working** — don't rely on them until re-validated.
- **Native GPU rendering (bare-metal Linux, outside a VM or cluster)**: not tested. This is separate from the in-cluster OpenShift GPU path above, which has been validated.
- **Windows**: Untested.

## Getting Started

1. Install the extension — either the published image (Podman Desktop → Extensions → Install custom extension → `quay.io/sgahlot/physical-ai-extension:latest`, or a specific version tag) or load from source (see [`physical-ai/README.md`](../README.md))
2. Open **Physical AI**, or press **F1** → **Physical AI: Open Dashboard**
3. **Image Builder** → Quick Start **Local** (**TurtleBot3 Sim (Jazzy)**) → Phase 1 Build → Phase 2 Build (use **OpenShift** for a cluster-pullable `amd64` image)
4. **Simulation** → Launch → **Show Viewer** (or Open in Browser) → Add TurtleBot3 → optional **Navigate** (X/Y) and Topic Monitor **Peek**
5. **Stop & remove** when done — close the Gazebo (noVNC) browser tab manually if it is still open
6. Adjust defaults under **Settings → Preferences → Physical AI** (including **Simulation GPU passthrough** on Mac)

Idle noVNC tabs may show Disconnected; reconnect or refresh — the simulation is still running. Lidar/IMU topics are available after spawn when using a current sim image; **Navigate** on Jazzy sim uses Nav2 (`navigate_to_pose`) with obstacle-aware planning (Humble images still use open-loop `cmd_vel`).

## Navigate (Jazzy)

On Jazzy sim images, each spawned robot has **Navigate** (target X/Y in the map frame). The extension launches Nav2 if needed and sends a `navigate_to_pose` goal with lidar-based obstacle avoidance.

**Nav2 warming** — After spawn, the extension starts Nav2 in the background so the first **Navigate** is not a cold start. While warming you see **Nav2 warming…** and the target/Navigate controls stay hidden until Nav2 is ready (or warming fails — **Navigate** can still cold-start Nav2, just slower).

**First goal delay (~15–20 s)** — On the first **Navigate** after spawn, the stack finishes coming up, stale costmap cells from startup are cleared, and the global planner must find a path. The robot may stay still while status shows **Navigating…** — this is normal, not a hang. The second goal on the same robot is usually much faster.

**Slow, hopping, or “stuck” motion** — Usually (1) **not enough CPU** for the pod quota (Gazebo GUI, physics, and Nav2 compete; throttling makes sim time run slower than real time), or (2) **Nav2 recovery** (spin/backup/clear costmap while the planner retries). On OpenShift, dial **Guaranteed CPUs (sim container)** — see [GPU and rendering](#gpu-and-rendering) for software vs GPU sizing. In-extension Help has more detail.

## Settings

- **Default Namespace** — Quay.io namespace for catalog and image tags
- **Catalog view mode** — `all` (default) or `curated`
- **Catalog curated allowlist** — comma-separated repo name patterns (`*` wildcard), default `ros2-*-base,ros2-*-turtlebot3,ros2-*-sim*`
- **Simulation image allowlist** — optional comma-separated image refs or patterns for Simulation launch. Empty = default `ros2-*-sim*` / `ros2-*-turtlebot3`. Pin exact tags or `@sha256:…` digests for demos. Local image *content* is still trusted once selected.
- **Simulation GPU passthrough** — on arm64 Mac, pass `/dev/dri` into sim containers (default on). Disable to force software rendering (`llvmpipe`).
- **Topic peek timeout** — seconds to wait for Topic Monitor **Peek** (`ros2 topic echo --once`). Whole number 1–30; default 5.
- **Default guaranteed CPUs** — seeds the **Guaranteed CPUs (sim container)** field on the OpenShift tab (1–64, default 8 for software-render deploys).
- Image Builder wizard defaults (robot, distro, middleware, engine, base preset)

## Golden images to publish

Pre-built images to push to your Quay.io namespace so that users can pull and run without building locally. For a quick showcase, push just the Jazzy base + sim pair — users pull the sim image directly instead of building for ~20 minutes.

Build via Image Builder (or CLI against `assets/`), then push:

### Base images (Phase 1 outputs)

- `quay.io/<ns>/ros2-jazzy-base:latest` — Jazzy headless base for amd64. No GUI, for CI or headless ROS2 work.
- `quay.io/<ns>/ros2-jazzy-base:noble` — Jazzy base for arm64 (the Quick Start path). This is what Phase 1 produces on Mac.

### Simulation images (Phase 2 outputs, built on top of a base)

- `quay.io/<ns>/ros2-jazzy-sim:noble` — The Jazzy sim: Gazebo + noVNC + Nav2 (launched on **Navigate** via `entrypoint-nav2.sh`).

## Coming Soon

- **Customize hardware** — Swap sensors on a running robot
- **Fleet** — Multi-robot scaling for local simulations (with Zenoh)
- **Humble support** — TurtleBot3 sim on ROS2 Humble exists in the codebase (`assets/ros2-humble-base`, `assets/ros2-humble-turtlebot3`) but is not currently verified working; needs re-validation before it's recommended

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

**In-cluster CPU sizing (no GPU):** software rendering is CPU-bound — the `gz sim -g` GUI client alone needs ~2.3 cores to render the scene for noVNC, and during *active* Nav2 navigation the planner/controller/costmaps add ~1 more. On a 2-core pod the sim's real-time factor collapses to ~0.1 (goals never finish); at 4 cores goals complete but active-nav utilization hits ~90%, so RTF sags to ~0.3–0.6 and motion is slow and jerky. The software-rendering Deployment therefore requests **8 guaranteed CPUs by default** (`requests == limits`), which keeps utilization comfortable with headroom so navigation runs at ~real-time (RTF ~1.0, a warm ~2 m trip in ~33 s). The count is **configurable** via **Guaranteed CPUs (sim container)** on the OpenShift tab (`OpenShiftDeployConfig.cpu`, validated 1–64) so you can dial it to your node sizes — note an N-CPU Guaranteed pod only schedules on a node with ≥ N *allocatable* CPU. The bottleneck is the GUI (not the depth camera), so dropping sensors doesn't lower the requirement — a GPU does. A residual micro-stutter used to remain because the container sees all host CPUs but is CFS-throttled to the quota (Gazebo/Ogre size thread pools to the visible count); `entrypoint-gazebo.sh` now caps the render/physics thread pools (`OMP_/OPENBLAS_/LP_/MESA_/GALLIUM_NUM_THREADS`) to the cgroup quota to remove it (takes effect after an image rebuild + push).

**In-cluster with a GPU (OpenShift + NVIDIA GPU operator):** the **OpenShift** tab has a **"Cluster has a GPU"** toggle. When on, the Deployment requests `nvidia.com/gpu: 1` and sets `PHYSICAL_AI_USE_GPU=1` (dropping the software-rendering env). The entrypoint renders the server off-screen via **hardware EGL** (`--headless-rendering`, no `surfaceless`/llvmpipe override); the GUI (`gz sim -g`) GPU-renders via **VirtualGL** (`vglrun -d egl`, APPENG-6083). Sensor rendering stays on software EGL to avoid a known long-run GPU driver issue.

**GPU offloads rendering, not physics or Nav2** — you still need enough guaranteed CPU for Gazebo, physics, and navigation. On a `g5.2xlarge` GPU node (~7500m allocatable after system overhead), use **7** guaranteed CPUs without the Hummingbird sidecar, or **6** with it (the sidecar adds 50m). Values like 2–3 schedule but simulation runs below real time and **Navigate** looks slow, frozen, or jerky. Set via **Guaranteed CPUs (sim container)** on the OpenShift tab. **Validated live:** single robot at 6 CPUs with GPU + Hummingbird, smooth Nav2 navigation at ~real time. Multi-robot behavior on this path has not yet been characterized. The default (toggle off) is the tested software path above.

**Ogre2 Sensors (2026-08 re-verification):** The `gz-sim-sensors-system` plugin no longer segfaults on current Gazebo Harmonic + Mesa (llvmpipe or virtio-gpu). It is re-enabled in `tb3_sandbox.sdf.xacro`. Lidar (`/scan`) and IMU topics are available after spawn.

On **Linux with a native GPU** (not in a VM), Ogre2 may work without these workarounds, **but this has not been tested.**

### Single container architecture

The simulation runs everything in a single Podman container (not a pod). The original plan used separate containers in a pod for ROS2, Gazebo, and noVNC. On Mac Apple Silicon, the combined memory pressure of the pod-based setup caused Nav2 to OOMKill at 4 GiB. A single container with all components baked in eliminates infra container overhead and fits within the default Podman Machine (~5.7 GB).

Robots are added to the running container via `podman exec` (not by starting additional containers).

### Two-phase image build

The Image Builder splits the build into a base image (Phase 1) and a simulation image (Phase 2) that layers on top via `FROM $LOCAL_BASE_IMAGE`. This is a practical optimization:

- **Build speed** — The base (ROS2 core, ~1–2 GB of apt packages) rarely changes. Sim layer rebuilds take ~5 min vs ~15–20 min for the full stack.
- **Shared foundation** — Multiple sim images can share the same base (Jazzy sim, future robot types).
- **Smaller pushes** — If the base is already on Quay, only the sim diff layers are transferred.
- **Non-simulation use** — The base image works standalone for headless ROS2 development or CI.
