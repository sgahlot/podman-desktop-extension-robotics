# Story 2: Single Robot Simulation Workflow — 🟡 In Progress

**Jira:** APPENG-5765 | **Parent:** APPENG-5763 (Epic) | **Priority:** MVP-critical

**Description:** Enable one-click launch of a ROS2 robot in Gazebo simulation from the extension. Provide browser-based visualization (noVNC or web streaming) so developers never touch a terminal. Include a basic topic inspection panel showing ROS2 messages flowing.

---

## Sub-task Progress

| Status | Key | Summary |
|--------|-----|---------|
| ✅ | APPENG-5771 | Container orchestration for ROS2 + Gazebo launch via Podman pod |
| ✅ | APPENG-5772 | Integrate noVNC or web-based video stream for simulation visualization |
| ⚪ | APPENG-5773 | Build topic monitor panel showing active ROS2 topics and message rates |

> **See also:** [Story 6 (Podman-only simulation)](story6-podman-sim.md) implements the core of this story (APPENG-5771 container orchestration + APPENG-5772 noVNC) using a Podman-only approach for the ROSCon demo.

---

## APPENG-5771: Container Orchestration for ROS2 + Gazebo — ✅ Done (via Story 6)

**Description:** Implement one-click launch of a ROS2 robot with Gazebo simulation running in a Podman pod, managed from the extension.

**Implemented in [Story 6](story6-podman-sim.md)** using Podman-only (no pods/compose). Backend lifecycle API (`launchSimulation`, `stopSimulation`, `deleteSimulation`, `listSimulationContainers`, `execInSimulation`) + Simulation page with one-click launch, container polling, stop/delete. Robot spawn via `podman exec`. Single-container architecture: Gazebo + Nav2 + noVNC in one image (`ros2-jazzy-sim-arm64`).

---

## APPENG-5772: noVNC / Web Streaming Integration — ✅ Done (via Story 6)

**Description:** Provide browser-based visualization of the running Gazebo simulation so developers never need to touch a terminal or install GUI tools locally.

**Implemented in [Story 6](story6-podman-sim.md).** noVNC display stack (Xvfb + x11vnc + websockify) baked into the simulation image. "Open in Browser" button on the Simulation page opens `localhost:6080`. Software rendering via llvmpipe (Ogre2 Sensors plugin removed due to arm64 segfault — visuals/physics unaffected).

---

## APPENG-5773: Topic Monitor Panel — ⚪ Not Started

**Description:** Add a panel in the extension UI that displays active ROS2 topics, message types, and publishing rates for basic inspection without CLI tools.

*No work done yet.*
