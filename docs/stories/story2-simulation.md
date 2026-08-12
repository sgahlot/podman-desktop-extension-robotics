# Story 2: Single Robot Simulation Workflow — 🟡 In Progress

**Jira:** APPENG-5765 | **Parent:** APPENG-5763 (Epic) | **Priority:** MVP-critical

**Description:** Enable one-click launch of a ROS2 robot in Gazebo simulation from the extension. Provide browser-based visualization (noVNC or web streaming) so developers never touch a terminal. Include a basic topic inspection panel showing ROS2 messages flowing.

---

## Sub-task Progress

| Status | Key | Summary |
|--------|-----|---------|
| ✅ | APPENG-5771 | Container orchestration for ROS2 + Gazebo launch via Podman pod |
| ✅ | APPENG-5772 | Integrate noVNC or web-based video stream for simulation visualization |
| ✅ | APPENG-5773 | Build topic monitor panel showing active ROS2 topics and message rates |
| 🟠 | APPENG-5920 | Add navigation UI for driving robots in simulation — **In Review** |
| 🟠 | APPENG-5922 | Topic Monitor drill-down — **In Review** |
| 🟠 | APPENG-5923 | Topic Monitor message peek — **In Review** |
| ⚪ | APPENG-5980 | Local Nav2 feasibility spike on Apple Silicon (Mac) — **New** |
| ⚪ | APPENG-5981 | Wire Simulation Go to local Nav2 (`navigate_to_pose`) — **In progress** |

> **See also:** [Story 6 (Podman-only simulation)](story6-podman-sim.md) implements the core of this story (APPENG-5771 container orchestration + APPENG-5772 noVNC) using a Podman-only approach for the ROSCon demo.

---

## APPENG-5771: Container Orchestration for ROS2 + Gazebo — ✅ Done (via Story 6)

**Description:** Implement one-click launch of a ROS2 robot with Gazebo simulation running in a Podman pod, managed from the extension.

**Implemented in [Story 6](story6-podman-sim.md)** using Podman-only (no pods/compose). Backend lifecycle API (`launchSimulation`, `stopSimulation`, `deleteSimulation`, `listSimulationContainers`, `execInSimulation`) + Simulation page with one-click launch, container polling, stop & remove. Robot spawn via `podman exec`. Single-container architecture: Gazebo + noVNC in one image (`ros2-jazzy-sim`; Nav2 packages in image, stack deferred to OpenShift).

---

## APPENG-5772: noVNC / Web Streaming Integration — ✅ Done (via Story 6)

**Description:** Provide browser-based visualization of the running Gazebo simulation so developers never need to touch a terminal or install GUI tools locally.

**Implemented in [Story 6](story6-podman-sim.md).** noVNC display stack (Xvfb + x11vnc + websockify) baked into the simulation image. "Open in Browser" button on the Simulation page opens `localhost:6080`. On arm64 Mac, launch passes `/dev/dri` by default (virtio-gpu); `llvmpipe` fallback when GPU passthrough is disabled in Preferences.

---

## APPENG-5773: Topic Monitor Panel — ✅ Done

**Description:** Add a panel in the extension UI that displays active ROS2 topics, message types, and publishing rates for basic inspection without CLI tools.

### Implementation Notes

**New files:**
- `packages/shared/src/types/TopicInfo.ts` — `TopicInfo` interface (name, type, publishers, subscribers)
- `packages/frontend/src/TopicMonitor.svelte` — Topic Monitor page with container selector, topics table (Topic, Message Type, Pubs, Subs), auto-poll every 5s, no-sim-running state with link to Simulation page
- `packages/frontend/src/TopicMonitor.spec.ts` — 4 tests (heading, no-sim message, topics table, column headers)

**Modified files:**
- `packages/shared/src/PhysicalAiApi.ts` — added `listRosTopics(containerId): Promise<TopicInfo[]>`
- `packages/backend/src/api-impl.ts` — implemented `listRosTopics()` with:
  - Private `#execAttached()` — same as `execInSimulation` but without `-d` flag (captures stdout/stderr)
  - Private `#detectRosDistro()` — inspects container image tag for humble/jazzy, defaults to jazzy
  - Runs `ros2 topic list` + `ros2 topic info` via attached exec, parses output, batches 5 topics at a time
- `packages/backend/src/api-impl.spec.ts` — 6 new tests for `listRosTopics`
- `packages/frontend/src/App.svelte` — added `/topics` route
- `packages/frontend/src/Dashboard.svelte` — added "Topic Monitor" quick-link card
- `packages/frontend/src/SimulationPage.svelte` — added "View Topics" button on running container cards
- `packages/frontend/src/Help.svelte` — added Topic Monitor section

**Key decisions:**
- Hz measurement deferred — `ros2 topic hz` needs to run for several seconds per topic, too expensive for polling
- Uses attached `podman exec` (no `-d` flag) to capture `ros2` CLI output; existing detached mode kept for robot spawn
- ROS distro auto-detected from container image tag for correct `setup.bash` path

---

## APPENG-5920: Navigation UI — 🟠 In Review

**Description:** Add a "Go" button with target X/Y coordinates on the Simulation page that drives a robot to the specified location.

### Implementation Notes

**Done (local / Mac, Jazzy):** Nav2 autonomous navigation. Backend launches Nav2 via `entrypoint-nav2.sh` when needed, seeds AMCL from current pose, and sends `navigate_to_pose` goals. Per-robot X/Y + **Go**, status feedback (Navigating / Reached / Failed), Help, tests.

**Humble fallback:** Direct velocity control via `cmd_vel` (turn + drive) when image tag includes `humble`.

**OpenShift:** Same action path reusable in-cluster (Story 4 / APPENG-5767).

**New files:**
- `packages/backend/assets/ros2-jazzy-sim/entrypoint-nav2.sh` — launches Nav2 navigation stack (unused from UI on arm64; ready for OpenShift wiring)
- `packages/shared/src/types/NavigationGoalResult.ts` — `NavigationGoalResult` interface (status, message)

**Modified files:**
- `packages/backend/assets/ros2-jazzy-sim/Containerfile` — added COPY + chmod for `entrypoint-nav2.sh`
- `packages/shared/src/PhysicalAiApi.ts` — `sendNavigationGoal()`
- `packages/backend/src/api-impl.ts` — `sendNavigationGoal` queries pose, publishes turn/drive/stop via attached `podman exec`
- `packages/frontend/src/SimulationPage.svelte` — per-robot navigation controls (X/Y inputs, Go button, status with snapshotted coordinates)
- `packages/frontend/src/Help.svelte` — added Navigate section under Simulation
- `packages/backend/src/api-impl.spec.ts` — tests for `sendNavigationGoal`

**Architecture:**
1. User clicks "Go" → frontend calls `sendNavigationGoal(containerId, robotName, x, y)`
2. Backend queries current pose, computes heading, publishes turn then drive via `ros2 topic pub`
3. Backend sends stop command, returns `NavigationGoalResult`
4. Frontend shows status: Driving → Drove to (X, Y) / Failed

---

## APPENG-5922: Topic Monitor Drill-down — 🟠 In Review

**Description:** Expandable topic rows showing publisher/subscriber node names via `ros2 topic info -v`. On-demand fetch when the row expands (not on the 5s topic-list poll).

See plan notes (2026-08-04): `getRosTopicDetail`, expandable UI, on-demand fetch.

---

## APPENG-5923: Topic Monitor Message Peek — 🟠 In Review

**Description:** Add a **Peek** button on expanded Topic Monitor rows that shows one live message snapshot via `ros2 topic echo --once`, polished toward a topic-browser inspector.

### Implementation Notes

**Types / API:**
- `TopicPeekResult` (+ `capturedAt`, `messageStamp`, `truncated`) in `packages/shared/src/types/TopicInfo.ts`
- `TopicSchemaResult` + `getRosMessageSchema(containerId, messageType)`
- `peekRosTopic(containerId, topicName)` on `PhysicalAiApi`
- Shared helpers: `packages/shared/src/ros/topicPeek.ts` (clean echo, stamp extract, YAML tree, short type badge)
- Preferences: `physical-ai.topicPeekTimeoutSeconds` (1–30, default 5); out-of-range values surface a clear error

**Backend:**
- Validates sim container + topic name; runs `timeout <N> ros2 topic echo --once --qos-reliability best_effort --qos-durability volatile`
- `N` from Preferences via `getTopicPeekTimeoutSeconds` / `setTopicPeekTimeoutSeconds` (asserted 1–30)
- Cleans DDS lost-message noise; caps payload size; returns capture metadata
- Schema via `ros2 interface show` with message-type allowlist

**Frontend:**
- Soft topology (pubs → topic → subs), type badges, schema toggle
- Peek inspector: topic/type header, Captured / Msg stamp, Tree/Raw toggle, Copy
- Improved idle-topic timeout copy

**Tests:** shared peek helpers; backend peek + schema; frontend topology/schema/peek

---

## APPENG-5980: Local Nav2 Feasibility Spike (Apple Silicon) — ⚪ New

**Description:** Timeboxed feasibility spike to determine whether Nav2 can run reliably in the local Podman simulation path on Apple Silicon Mac.

**Planned output:** a go/no-go decision with constraints, blockers, and recommended next step (local enablement vs keep Nav2 deferred to OpenShift).

**Validation matrix (initial):**
- llvmpipe rendering (software)
- GPU passthrough enabled (`/dev/dri`)
- Sensors publishing after spawn (`/scan`, `/imu`)
- Nav2 bringup lifecycle/action availability
- Basic goal attempt + observed behavior

**First run findings (2026-08-11):**
- Repro script added: `scripts/test-nav2-local-feasibility.sh`
- Sensors are present locally (`/robot_1/scan`, `/robot_1/imu`) and GPU device nodes are visible in-container (`/dev/dri/*`).
- Legacy path (`navigation_launch.py namespace:=robot_1`) fails at `controller_server` with `No critics defined for FollowPath` because `RewrittenYaml` wraps params under the namespace key but `navigation_launch.py` does not push that namespace onto nodes.
- Non-namespaced `navigation_launch.py` loads MPPI critics but stalls on activation waiting for TF `base_link -> odom` because odom TF is on `/robot_1/tf` while `robot_state_publisher` publishes static TF to global `/tf_static`.

**Fix implemented (2026-08-12):**
- `entrypoint-nav2.sh` now uses `bringup_launch.py` with `use_namespace:=True`, `tb3_sandbox` map, and runtime-patched params (`lib/patch-nav2-params.py` rewrites absolute `/scan`, `/odom`, `/map` topics to relative names).
- `entrypoint-spawn-robot.sh` remaps `robot_state_publisher` TF output to `/robot_1/tf` and `/robot_1/tf_static` so namespaced Nav2 sees the full `odom -> base_footprint -> base_link` chain.
- Re-test result: MPPI critics configure, map loads on `/robot_1/map`, scan subscription succeeds; activation requires a fresh robot spawn after the TF remap change.
- Result: **go** for local Nav2 on Mac (5980); APPENG-5981 wires Simulation **Go** to `navigate_to_pose`.

---

## APPENG-5981: Wire Simulation Go to Local Nav2 — In progress

**Description:** Replace open-loop `cmd_vel` **Go** with Nav2 autonomous navigation for local Jazzy simulation (follow-on to APPENG-5980).

**Scope:**
- Launch Nav2 via `/entrypoint-nav2.sh` when not already running (per robot namespace)
- Backend `sendNavigationGoal` sends `/robot_N/navigate_to_pose` on Jazzy sim images
- Seed AMCL initial pose from current robot pose when starting Nav2
- Preserve per-robot navigating / reached / failed UI status
- Keep `cmd_vel` fallback for Humble/non-Nav2 images

**Out of scope:** dedicated boundary min/max UI (Nav2/map rejects invalid goals); multi-waypoint routing.

**Acceptance criteria:**
- **Go** on Jazzy sim uses Nav2 with obstacle-aware planning
- UI reflects action result (reached / failed)
- Backend tests cover Nav2 goal path (mocked exec)
- Docs/help text updated

**Validation (2026-08-12):** `scripts/test-nav2-go-e2e.sh` on Mac (`pai-sim-5981-e2e`, `ros2-jazzy-sim:noble`) — spawn `robot_1`, launch Nav2, `navigate_to_pose` to `(1.0, 1.0)` **SUCCEEDED** (~15s nav time). Backend waits for `map→base_link` TF after Nav2 launch before sending goals.
