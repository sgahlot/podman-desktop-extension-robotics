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
| 🟡 | APPENG-5920 | Add Nav2 goal-sending UI for autonomous robot navigation in simulation |

> **See also:** [Story 6 (Podman-only simulation)](story6-podman-sim.md) implements the core of this story (APPENG-5771 container orchestration + APPENG-5772 noVNC) using a Podman-only approach for the ROSCon demo.

---

## APPENG-5771: Container Orchestration for ROS2 + Gazebo — ✅ Done (via Story 6)

**Description:** Implement one-click launch of a ROS2 robot with Gazebo simulation running in a Podman pod, managed from the extension.

**Implemented in [Story 6](story6-podman-sim.md)** using Podman-only (no pods/compose). Backend lifecycle API (`launchSimulation`, `stopSimulation`, `deleteSimulation`, `listSimulationContainers`, `execInSimulation`) + Simulation page with one-click launch, container polling, stop/delete. Robot spawn via `podman exec`. Single-container architecture: Gazebo + Nav2 + noVNC in one image (`ros2-jazzy-sim`).

---

## APPENG-5772: noVNC / Web Streaming Integration — ✅ Done (via Story 6)

**Description:** Provide browser-based visualization of the running Gazebo simulation so developers never need to touch a terminal or install GUI tools locally.

**Implemented in [Story 6](story6-podman-sim.md).** noVNC display stack (Xvfb + x11vnc + websockify) baked into the simulation image. "Open in Browser" button on the Simulation page opens `localhost:6080`. Software rendering via llvmpipe (Ogre2 Sensors plugin removed due to arm64 segfault — visuals/physics unaffected).

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

## APPENG-5920: Nav2 Goal-Sending UI — 🟡 In Progress

**Description:** Add a "Navigate to" control on the Simulation page that sends a Nav2 goal to a running robot. The robot autonomously plans a path and drives to the target using Nav2's built-in obstacle avoidance.

### Implementation Notes

**Key discovery:** The existing `entrypoint-spawn-robot.sh` only launches the robot model + `robot_state_publisher` — it does **not** start Nav2's navigation stack. A new `entrypoint-nav2.sh` script is needed to launch `nav2_bringup navigation_launch.py` per robot.

**New files:**
- `packages/backend/assets/ros2-jazzy-sim/entrypoint-nav2.sh` — launches Nav2 navigation stack for a given robot namespace via `podman exec -d`
- `packages/shared/src/types/NavigationGoalResult.ts` — `NavigationGoalResult` interface (status, message)

**Modified files:**
- `packages/backend/assets/ros2-jazzy-sim/Containerfile` — added COPY + chmod for `entrypoint-nav2.sh`
- `packages/shared/src/PhysicalAiApi.ts` — added `startNav2(containerId, robotName)` and `sendNavigationGoal(containerId, robotName, x, y)`
- `packages/backend/src/api-impl.ts` — implemented both methods: `startNav2` uses detached exec, `sendNavigationGoal` uses attached exec with `ros2 action send_goal` and parses result
- `packages/frontend/src/SimulationPage.svelte` — per-robot navigation controls (X/Y inputs, Go button, nav status display)
- `packages/frontend/src/Help.svelte` — added Navigate section under Simulation
- `packages/backend/src/api-impl.spec.ts` — 8 new tests for `startNav2` and `sendNavigationGoal`

**Architecture:**
1. User clicks "Go" → frontend calls `startNav2()` (detached, first time only) → waits 5s for Nav2 initialization
2. Frontend calls `sendNavigationGoal()` → backend runs `ros2 action send_goal` (attached, blocks until complete)
3. Backend parses stdout for SUCCEEDED/ABORTED/rejected → returns `NavigationGoalResult`
4. Frontend shows status: Starting Nav2 → Navigating → Reached / Failed

**Note:** Simulation image must be rebuilt to include `entrypoint-nav2.sh`.
