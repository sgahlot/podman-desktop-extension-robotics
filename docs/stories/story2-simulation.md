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
| 🟡 | APPENG-5920 | Add navigation UI for driving robots in simulation |
| ✅ | APPENG-5922 | Topic Monitor drill-down |
| ✅ | APPENG-5923 | Topic Monitor message peek |

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

## APPENG-5920: Navigation UI — 🟡 In Progress

**Description:** Add a "Go" button with target X/Y coordinates on the Simulation page that drives a robot to the specified location.

### Implementation Notes

**Current approach (arm64 / local laptop):** Direct velocity control. Backend queries robot pose via `gz model -m <name> -p`, then publishes `cmd_vel` Twist messages to turn and drive in a straight line. No obstacle avoidance — Ogre2 Sensors crash on arm64 llvmpipe blocks Nav2 (no lidar/costmap data).

**Target (amd64 / OpenShift with GPU):** Nav2 autonomous navigation with obstacle avoidance. Once Ogre2 Sensors is re-enabled, the Nav2 navigation stack can be launched per robot and goals sent via `navigate_to_pose` — the robot will autonomously plan a path and avoid obstacles. The backend plumbing is already in place to support this switch.

**New files:**
- `packages/backend/assets/ros2-jazzy-sim/entrypoint-nav2.sh` — launches Nav2 navigation stack (unused on arm64; ready for amd64/OpenShift)
- `packages/shared/src/types/NavigationGoalResult.ts` — `NavigationGoalResult` interface (status, message)

**Modified files:**
- `packages/backend/assets/ros2-jazzy-sim/Containerfile` — added COPY + chmod for `entrypoint-nav2.sh`
- `packages/shared/src/PhysicalAiApi.ts` — added `startNav2()` and `sendNavigationGoal()`
- `packages/backend/src/api-impl.ts` — `startNav2` is a no-op stub; `sendNavigationGoal` queries pose, publishes turn/drive/stop via attached `podman exec`
- `packages/frontend/src/SimulationPage.svelte` — per-robot navigation controls (X/Y inputs, Go button, status with snapshotted coordinates)
- `packages/frontend/src/Help.svelte` — added Navigate section under Simulation
- `packages/backend/src/api-impl.spec.ts` — 6 tests for `startNav2` and `sendNavigationGoal`

**Architecture:**
1. User clicks "Go" → frontend calls `sendNavigationGoal(containerId, robotName, x, y)`
2. Backend queries current pose, computes heading, publishes turn then drive via `ros2 topic pub`
3. Backend sends stop command, returns `NavigationGoalResult`
4. Frontend shows status: Driving → Drove to (X, Y) / Failed

---

## APPENG-5922: Topic Monitor Drill-down — ✅ Done

**Description:** Expandable topic rows showing publisher/subscriber node names via `ros2 topic info -v`.

See plan notes (2026-08-04): `getRosTopicDetail`, expandable UI, on-demand fetch.

---

## APPENG-5923: Topic Monitor Message Peek — ✅ Done

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
