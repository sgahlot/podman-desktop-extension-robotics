# Story 6: Podman-Only Simulation Workflow (ROSCon Demo) — 🟡 In Progress

**Jira:** *(no Jira — ROSCon demo track)* | **Parent:** APPENG-5763 (Epic) | **Priority:** MVP-critical

**Description:** Enable interactive robot simulation from the extension using Podman only — no Kubernetes. User can launch a Gazebo simulation, add a TurtleBot3 into the running world, and view everything in their browser via noVNC. Two paths: (A) one-click build-and-run via Image Builder quick-start, (B) interactive layered flow where the user starts an empty world then adds robots.

**Target:** ROSCon Toronto demo, September 2026.

**Status:** **Demo path complete** (S6-1–S6-5). **S6-6 Customize Hardware deferred** (stretch — not this pass). Story remains “In Progress” only because S6-6 is unfinished stretch.

---

## Relationship to Other Stories

- **[Story 2 (APPENG-5765)](story2-simulation.md):** Story 6 implements the core of Story 2 (single robot sim workflow) using a Podman-only approach. APPENG-5771 (container orchestration), APPENG-5772 (noVNC) are directly addressed here.
- **[Story 5 (Spike)](../podman-extension-plan.md#story-5):** The Kind **multi-pod** approach is parked at branch `spike/repo-b-kind-attempt` (Nav2 OOMKill at ~4Gi on arm64). Learnings (Containerfile, entrypoints, noVNC) feed into Story 6. A **lean Kind** revisit (one sim Deployment, Story 6 parity) is documented in the plan Story 5 revisit note (2026-08-10).
- **[Story 3](story3-multi-robot.md):** The `podman exec` spawn pattern lays groundwork for multi-robot fleet scaling.

---

## Two User Paths

### Path A — Fast/Practical (Image Builder Quick-Start)

1. Click "TurtleBot3 Sim (Jazzy)" quick-start in Image Builder → pre-fills all 5 dropdowns, **saves** preferences, and scrolls to Phase 1 Build
2. Click **Build** for Phase 1 (base), then Phase 2 (sim) — Quick Start does **not** auto-build
3. Go to Simulation card → Launch → Open in Browser → Add TurtleBot3

### Path B — Interactive/Demo (ROSCon Story)

1. Launch base Gazebo image (empty world + noVNC) from Simulation page
2. Click "Add TurtleBot3" → robot appears in the running sim via `podman exec`
3. Set target X/Y and click **Navigate** (Jazzy: Nav2 `navigate_to_pose` with obstacle avoidance; Humble: open-loop `cmd_vel`)
4. *(Stretch / deferred)* "Customize Hardware" → swap camera sensor (S6-6 — not started)

---

## Sub-task Progress

| Status | ID | Summary | Blocks | Est |
|--------|------|---------|--------|-----|
| ✅ | S6-1 | Jazzy arm64 simulation Containerfile + entrypoints | S6-3, S6-4 | 2-3d |
| ✅ | S6-2 | Image Builder quick-start preset button | — | 0.5d |
| ✅ | S6-3 | Backend container lifecycle API (create/start/stop/exec) | S6-4, S6-5 | 2d |
| ✅ | S6-4 | Simulation page: launch, status, open, stop | S6-5 | 2d |
| ✅ | S6-5 | Add TurtleBot3 (podman exec spawn) | S6-6 | 1d |
| ⚪ | S6-6 | Customize Hardware card *(stretch — deferred)* | — | 1-2d |

**Dependency chain:** S6-1 → S6-3 → S6-4 → S6-5 → S6-6. S6-2 is independent.

---

## S6-1: Jazzy arm64 Containerfile + Entrypoints

**Goal:** Single container image (Ubuntu 24.04 Noble + ROS2 Jazzy arm64 + Gazebo Harmonic + noVNC) that builds and runs natively on Mac M3 Pro. This is the runtime image for both paths.

### Why Jazzy on arm64

The existing Humble TurtleBot3 sim image requires amd64-only packages (ros-humble-ros-gz, nav2-bringup), meaning QEMU emulation on Mac. Jazzy on Ubuntu Noble has **official arm64 binary packages** for ROS2, Gazebo, and Nav2 (Tier 1). We proved this builds successfully in the Kind spike.

### Assets to create

New directory: `packages/backend/assets/ros2-jazzy-sim/`

| File | Description |
|------|-------------|
| `Containerfile` | Ubuntu 24.04 + ROS Jazzy apt packages + noVNC display stack. Key packages: `ros-jazzy-navigation2`, `ros-jazzy-nav2-bringup`, `ros-jazzy-nav2-minimal-tb3-sim`, `ros-jazzy-ros-gz-bridge`, `ros-jazzy-ros-gz-sim`, `ros-jazzy-gz-sim-vendor`, `xvfb`, `x11vnc`, `novnc`, `python3-websockify`, `openbox`. Ubuntu uses `libgl1`/`libegl1` (not mesa variants). ROS prefix: `/opt/ros/jazzy/`. |
| `entrypoint-gazebo.sh` | Starts Xvfb → openbox → x11vnc → websockify (noVNC on 6080) → Gazebo server + GUI. arm64: virtio-gpu when `/dev/dri` present (`PHYSICAL_AI_USE_GPU=1`), else `llvmpipe`. Optionally spawns robots from `ROBOTS` env var. |
| `entrypoint-spawn-robot.sh` | Accepts robot name + position as args. Sources ROS2, calls `spawn_tb3.launch.py` + `robot_state_publisher`. Used by `podman exec` for interactive robot add. |
| `worlds/tb3_sandbox.sdf.xacro` | Sandbox world from repo-b reference. |
| `www/index.html` | Simple landing page with noVNC link. |

### Shared types updates

- **SimulationProfiles.ts** — Add Jazzy sim profile (`ros2-jazzy-sim`)
- **SimulationBaseImages.ts** — Add `jazzy-noble` preset (Ubuntu 24.04, multi-arch)
- **SimulationConfig.ts** — Add `'jazzy-noble'` to `SimulationBaseImageId` union

### Validation

- `podman build -t ros2-jazzy-sim:test .` completes on Mac without `--platform linux/amd64`
- `podman run -d -p 6080:6080 ros2-jazzy-sim:test /entrypoint-gazebo.sh` starts
- Browser at `localhost:6080` shows Gazebo GUI (empty world, software rendered)
- `podman exec <id> /entrypoint-spawn-robot.sh robot_1 -2.0 -0.5 0.0` spawns TurtleBot3

### Implementation Notes (completed 2026-07-28)

**Files created:**
- `packages/backend/assets/ros2-jazzy-sim/Containerfile` — two-phase build pattern using `LOCAL_BASE_IMAGE` build arg, layered on `ros2-jazzy-base`
- `packages/backend/assets/ros2-jazzy-sim/entrypoint-gazebo.sh` — 9-stage startup (Xvfb → openbox → x11vnc → websockify → web page → xacro → gz server → optional robot spawn → gz GUI), 1024x768x16 resolution
- `packages/backend/assets/ros2-jazzy-sim/entrypoint-spawn-robot.sh` — `podman exec` entry point accepting `robot_name x y yaw` args, runs `spawn_tb3.launch.py` + `robot_state_publisher` as foreground with signal handling
- `packages/backend/assets/ros2-jazzy-sim/worlds/tb3_sandbox.sdf.xacro` — from repo-b reference with Sensors plugin **removed** (see finding below)
- `packages/backend/assets/ros2-jazzy-sim/www/index.html` — noVNC landing page

**Shared types modified:**
- `SimulationProfiles.ts` — added Jazzy sim profile with `assetDir: 'ros2-jazzy-sim'`, `imageName: 'ros2-jazzy-sim'`
- `SimulationBaseImages.ts` — added `jazzy-noble` preset (Ubuntu 24.04 Noble, multi-arch, `imageRef: 'docker.io/library/ros:jazzy-ros-base'`)

**Historical (2026-07):** `gz-sim-sensors-system` was reported to segfault under llvmpipe on arm64; plugin was temporarily removed from `tb3_sandbox.sdf.xacro`.

**Current (2026-08-11):** Re-tested on Gazebo Harmonic + Mesa — **no segfault** under llvmpipe or virtio-gpu (`scripts/test-sensors-gpu.sh`). Sensors plugin **re-enabled**. After spawn, `/robot_N/scan` and `/robot_N/imu` publish via `ros_gz_bridge`.

**Build fix:** The Containerfile initially listed `xacro` in the noVNC apt-get layer; on Ubuntu Noble it's `ros-jazzy-xacro` and was already installed as a dependency. Removed the duplicate to fix build error (exit code 100).

---

## S6-2: Image Builder Quick-Start Preset Button

**Goal:** One-click configure of a complete simulation image path from the Image Builder page.

Add a "Quick Start" section at the top of `SimulationSetup.svelte`, above the dropdowns. A "TurtleBot3 Sim" button that:

1. Pre-fills all dropdowns: `turtlebot3 / jazzy / dds / gazebo / jazzy-noble`
2. Saves config to Preferences
3. Scrolls to Phase 1 Build (user clicks Build for Phase 1 and Phase 2 explicitly)

Style like the Curated toggle pattern from `ImageCatalog.svelte`.

### Implementation Notes (completed 2026-07-28)

Modified `SimulationSetup.svelte`:
- Added "Quick Start" card above dropdowns with "TurtleBot3 Sim (Jazzy)" button
- Button pre-fills: `robot=turtlebot3, distro=jazzy, middleware=dds, engine=gazebo, baseImage=jazzy-noble`
- Updated Jazzy distro label from "Jazzy (base image only)" to "Jazzy (simulation)"
- Quick Start **saves** preferences and scrolls to Phase 1 Build (user still clicks Build explicitly; no auto-build)

---

## S6-3: Backend Container Lifecycle API

**Goal:** Backend methods to create, run, stop, delete, list, and exec into simulation containers.

### API surface (on `PhysicalAiApi`)

```
launchSimulation(imageTag, containerName, options) → containerId
stopSimulation(containerId)
deleteSimulation(containerId)
listSimulationContainers() → SimContainerInfo[]
execInSimulation(containerId, command[]) → ExecResult
openSimulationInBrowser(port)
```

### Key decisions

- **Container naming:** `pai-sim-<timestamp>`, labeled `io.physical-ai.role=simulation`
- **Container lifecycle:** Uses `containerEngine` API (create/start/stop/delete/list)
- **Exec:** Uses `extensionApi.process.exec('podman', ['exec', '-d', ...])` — the `containerEngine` API has no exec method. `-d` (detached) because robot spawn is long-running.
- **Single container, not a Podman pod:** No infra container overhead needed.

### New types

`SimLaunchOptions` (portMappings, env, cmd, labels), `SimContainerInfo` (id, name, imageTag, state, ports), `ExecResult` (exitCode, stdout, stderr) in `packages/shared/src/types/SimulationContainer.ts`.

### Implementation Notes (completed 2026-07-28)

**Files created:**
- `packages/shared/src/types/SimulationContainer.ts` — types + constants (`SIM_CONTAINER_LABEL`, `SIM_CONTAINER_LABEL_VALUE`, `SIM_CONTAINER_PREFIX`)

**Files modified:**
- `packages/shared/src/PhysicalAiApi.ts` — added 6 abstract methods
- `packages/backend/src/api-impl.ts` — implemented all 6 methods

**API findings during implementation:**
- `containerEngine.stopContainer()` / `deleteContainer()` take `(engineId: string, id: string)`, not `providerId` from connection
- `containerEngine.createContainer()` takes `(engineId: string, options)` and needs a separate `startContainer()` call — no `start: true` option
- `RunResult` has no `exitCode` field — only `command`, `stdout`, `stderr`. Used try/catch with `RunError` for exec error handling.
- Added `#getEngineId()` and `#findEngineIdForContainer()` private helpers to resolve the engine name from Podman connection

---

## S6-4: Simulation Page (Launch, Status, Open, Stop)

**Goal:** Enable the disabled "Simulation" dashboard card and build the page.

### Changes

- **Dashboard.svelte:** Change Simulation card from disabled `<div>` to active `<button>` with `router.goto('/simulation')`
- **App.svelte:** Add `<Route path="/simulation">` (same pattern as `/build`, `/images`)
- **SimulationPage.svelte (new):**
  - **Section 1 — Launch:** Dropdown of local sim images, "Launch" button, single-sim-at-a-time for MVP
  - **Section 2 — Running:** Polls `listSimulationContainers()` every 3s, shows container card with "Open in Browser" / "View Topics" (running only) and **Stop & remove**
  - **Section 3 — Add Robot:** See S6-5

### Implementation Notes (completed 2026-07-28)

**Files created:**
- `packages/frontend/src/SimulationPage.svelte` — full page with 3 sections (Launch, Running Containers, Add TurtleBot3). Polls `listSimulationContainers()` every 3s. Image dropdown filters for `/ros2-.*-sim|ros2-.*-turtlebot3/` pattern. Single-sim-at-a-time enforcement.

**Files modified:**
- `packages/frontend/src/App.svelte` — added `/simulation` route + `SimulationPage` import
- `packages/frontend/src/Dashboard.svelte` — changed Simulation card from disabled `<div>` to active `<button>` with `router.goto('/simulation')` and tooltip "Launch and manage robot simulations"

**UX refinements (completed later):**
- Launch card always shows dropdown + Launch button, both **disabled** (`.pai-btn-primary:disabled` — opacity 0.4, not-allowed cursor) when a simulation is running. No separate "Stop Simulation" branch — Stop only lives in the container card to avoid redundancy.
- Stop & remove button styled with `pai-btn-danger` class for visual distinction.
- Auto-cleanup of exited containers on page load.
- "View Topics" button added to running container cards (navigates to Topic Monitor page).
- `stopSim()` calls `deleteSimulation` (stop + remove in one step).
- 304/already-started errors handled gracefully (polls containers instead of showing error loop).

**Note:** CLI-built images (e.g. `ros2-jazzy-sim:test`) don't match the extension's tag pattern (`quay.io/.../ros2-jazzy-sim:noble`), so the Simulation page shows "No simulation images found locally" until images are built through the Image Builder. This is by design.

---

## S6-5: Add TurtleBot3 (podman exec spawn)

**Goal:** The interactive demo moment — spawn a robot into a running Gazebo world.

Inside SimulationPage Section 3 (enabled only when a sim is running):

- "Add TurtleBot3" button
- Inputs: Robot Name (auto-increment: `robot_1`, `robot_2`...), Position X/Y, Yaw
- "Spawn" → `execInSimulation(containerId, ['/entrypoint-spawn-robot.sh', name, x, y, yaw])`
- Spawned robots list with optimistic status tracking

### Implementation Notes (completed 2026-07-28)

Implemented in `SimulationPage.svelte` Section 3 — all in the same file as S6-4. Robot name auto-increments (`robot_1`, `robot_2`, ...). Inputs for X, Y, Yaw with sensible defaults. Spawned robots tracked in a list with name, position, and status. Uses `execInSimulation()` with detached mode (`-d` flag) since robot spawn is a long-running foreground process.

---

## S6-6: Customize Hardware *(stretch — deferred)*

Swap camera sensor on a robot. **Out of scope for the current polish pass.** Likely: parametric xacro with camera type arg passed via `podman exec`. Sensors plugin is enabled (2026-08); camera topic wiring for customize-hardware UX is still TBD.

---

## Risks

| Risk | Mitigation | Status |
|------|------------|--------|
| Gazebo + noVNC + Nav2 tight in 5.7GB VM | Measure in S6-1. Single container ~2-3GB. If tight, recommend `podman machine set --memory 8192`. | ✅ Fits — tested on Mac M3 Pro with default VM |
| Software rendering fallback | Disable GPU passthrough in Preferences | `llvmpipe` at 1024×768 still acceptable if virtio-gpu misbehaves |
| `ros-jazzy-nav2-minimal-tb3-sim` missing on arm64 | Verify in S6-1. If missing, build from source. | ✅ Available — arm64 binary packages exist |
| Ogre2 Sensors plugin on arm64 | Re-enabled 2026-08; segfault not reproduced on current stack | ✅ `/scan` and `/imu` after spawn |
| Port 6080 conflict | Check for running sim containers before launch; warn user. | ✅ Handled — single-sim enforcement in UI |

---

## Verification (end-to-end)

### CLI / image (done)

- [x] Containerfile builds natively on Mac arm64
- [x] `podman run` starts Gazebo, noVNC reachable at localhost:6080
- [x] `podman exec` spawns TurtleBot3 visible in Gazebo
- [x] Extension dashboard shows enabled Simulation card
- [x] Simulation page can launch and stop & remove containers
- [x] "Add TurtleBot3" button spawns robot into running sim
- [x] Image Builder quick-start pre-fills, saves, and scrolls to Phase 1 (user builds explicitly)

### ROSCon demo checklist (via extension)

Run this on a Mac with Podman Desktop + the Physical AI extension loaded. Expect `/scan` and `/imu` after spawn; **Navigate** on Jazzy sim uses Nav2 (`navigate_to_pose`).

1. [ ] **Image Builder** → Quick Start **TurtleBot3 Sim (Jazzy)** → Phase 1 Build → Phase 2 Build (or pull golden `ros2-jazzy-sim:noble`)
2. [ ] **Simulation** → Launch the sim image → container shows **running**
3. [ ] **Open in Browser** → Gazebo GUI via noVNC (`/vnc.html` with autoconnect + reconnect). Idle background tabs may disconnect; reconnect or refresh — sim still running
4. [ ] **Add TurtleBot3** → robot appears in Gazebo
5. [ ] **View Topics** / Topic Monitor → `/robot_1/scan`, `/robot_1/imu` → **Peek**
6. [ ] Set target **X/Y** → **Navigate** → robot navigates via Nav2 (Jazzy) or turns/drives via `cmd_vel` (Humble); status shows Navigating → Reached / Failed
7. [ ] **Stop & remove** → toast + on-page hint to close the Gazebo browser tab manually (container is deleted in one step)

### Deferred

- [ ] S6-6: Customize Hardware card *(stretch — not this pass)*
