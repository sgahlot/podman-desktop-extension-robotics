# Podman Desktop Extension for Physical AI Robotics Development — Plan

> Derived from Jira export.  
> Fields used: **Parent**, **Key**, **Issue Type**, **Created**, **Description**, **Summary**.  
> Keys and Summaries are unique across all 17 issues.

## Overview

Build a Podman Desktop extension that gives robotics developers a GUI-driven path from local development to OpenShift deployment. Target audience: robotics engineers unfamiliar with containers, CLI, or enterprise Linux. The extension provides curated Fedora/ROS2 base images, one-click simulation launch, and a bridge toward cluster deployment.

**MVP target:** ROSCon Toronto demo, September 2026

**Strategic drivers:**
- Push workloads to OpenShift and the Red Hat ecosystem
- Provide a clear path from Ubuntu builds on laptops to Fedora (and eventually RHEL) containers
- Bridge the gap from robotics lab projects to hardened, full-scale production deployment on OpenShift

---

## Epic

| Field | Value |
|-------|-------|
| **Key** | APPENG-5763 |
| **Parent** | — |
| **Issue Type** | Epic |
| **Created** | 2026/07/16 |
| **Summary** | Podman Desktop Extension for Physical AI Robotics Development |

**Description:** Build a Podman Desktop extension that gives robotics developers a GUI-driven path from local development to OpenShift deployment. Target audience: robotics engineers unfamiliar with containers, CLI, or enterprise Linux. The extension provides curated Fedora/ROS2 base images, one-click simulation launch, and a bridge toward cluster deployment. MVP targeting ROSCon Toronto demo in September 2026.

Drivers:
1. Push the workloads to OpenShift and the Red Hat ecosystem
2. Give a clear path from Ubuntu builds on laptops to Fedora and eventually RHEL containers
3. Bridge the large gap from robotics lab projects to hardened full-scale production deployment on OpenShift

---

## Progress Overview

| Story | Summary | Status | Sub-tasks |
|-------|---------|--------|-----------|
| APPENG-5764 | Extension scaffolding and base image catalog | ✅ Done | 4/4 done, 2 follow-ups parked |
| APPENG-5765 | Single robot simulation workflow | ⚪ Not Started | 0/3 done |
| APPENG-5766 | Multi-robot local scaling *(stretch)* | ⚪ Not Started | 0/3 done |
| APPENG-5767 | OpenShift deployment bridge *(stretch)* | ⚪ Not Started | 0/3 done |

> **Legend:** ✅ Done · 🟡 In Progress / Almost Done · ⚪ Not Started

**Last updated:** 2026-07-22

---

## Work Breakdown

### Story 1: Extension scaffolding and base image catalog — ✅ Done

> Detail doc: [story1-scaffolding.md](stories/story1-scaffolding.md)

| Key | Parent | Issue Type | Created | Summary |
|-----|--------|------------|---------|---------|
| APPENG-5764 | APPENG-5763 | Story | 2026/07/16 | Extension scaffolding and base image catalog |

**Description:** Build the Podman Desktop extension shell (registration, navigation, branding). Integrate a curated catalog of Fedora/ROS2 base images pullable from Quay. Include a project creation wizard to select robot type, middleware (Zenoh/DDS), and simulation engine.

#### Sub-tasks

| Status | Key | Summary | Description |
|--------|-----|---------|-------------|
| ✅ | APPENG-5768 | Scaffold Podman Desktop extension with TypeScript/Svelte boilerplate | Set up the Podman Desktop extension project structure, registration, and basic navigation shell. |
| ✅ | APPENG-5769 | Build and publish ROS2 Jazzy base image to Quay | Built with Ubuntu 24.04 interim base (Fedora migration tracked separately). Includes build & push UI in extension. Follow-ups parked. |
| ✅ | APPENG-5770 | Implement image catalog UI with pull and status indicators | Build the UI within the extension to browse curated base images, pull them from Quay, and show download/status indicators. |
| ✅ | APPENG-5808 | Project creation wizard and simulation image setup | Build a wizard UI for selecting robot type (e.g. TurtleBot3), ROS distro (Humble/Jazzy), middleware (Zenoh/DDS), and simulation engine (Gazebo). Create corresponding simulation Containerfiles (starting with ROS2 Humble + TurtleBot3 + Gazebo). Persist selections for Story 2 to consume. See implementation parts below. |

##### APPENG-5808 Implementation Parts

| Status | Part | Summary |
|--------|------|---------|
| ✅ | Part 1 | Simulation Containerfile — create `containers/ros2-humble-turtlebot3/` with Containerfile + entrypoint from side-work scripts; copy to `packages/backend/assets/` |
| ✅ | Part 2 | Wizard UI — new "Simulation Setup" page with dropdowns for robot/distro/middleware/engine; Dashboard card; persist selections via PD configuration |
| ✅ | Part 3 | Wire Build & Push — backend `buildSimulationImage()` API; build/push controls added to Simulation Setup page |

#### Follow-up tasks (from APPENG-5769 scope adjustments)

| Status | Key | Summary | Description |
|--------|-----|---------|-------------|
| 🅿️ | APPENG-5809 | Migrate ROS2 Jazzy base image from Ubuntu to Fedora | **Parked.** Jazzy has no official Fedora packages ([REP 2000](https://reps.openrobotics.org/rep-2000/) platforms are Ubuntu Noble Tier 1, Windows, RHEL 9 Tier 2 — not Fedora). Community COPRs / from-source builds are development-only and a maintenance sink for MVP. Interim Ubuntu (`ros:jazzy-ros-base`) remains correct. Revisit on concrete triggers (below), not vague “when packaging matures.” |
| 🅿️ | APPENG-5810 | Add rviz2/desktop variant of the base image | **Parked.** rviz2 pulls a full GUI stack (OpenGL, Qt, X11), so desktop images are much larger than `ros-base`. Story 2’s Gazebo + noVNC path (APPENG-5772) is the better ROSCon demo bet, but it is **not identical** to rviz2 (sim viz vs TF/sensor/robot-state debug). Revisit after APPENG-5772 once the demo viz path is proven. |

##### Research notes (park rationale, Jul 2026)

**APPENG-5809 — Ubuntu → Fedora**

- **Park decision stands.** Official Open Robotics binary packages for Jazzy do **not** target Fedora.
- **Nuance — Red Hat path ≠ Fedora path:** Official Jazzy RPMs already exist for **RHEL 9** via [`packages.ros.org`](https://docs.ros.org/en/jazzy/Installation/RHEL-Install-RPMs.html). If the goal is leaving Ubuntu for the Red Hat ecosystem, a **UBI/RHEL-based** image is closer than waiting on Fedora.
- **Community Fedora options exist but are not production-grade:** e.g. [`hellaenergy/ros2-jazzy`](https://copr.fedorainfracloud.org/coprs/hellaenergy/ros2-jazzy) / [nickschuetz/ros2-rpm](https://github.com/nickschuetz/ros2-rpm) — explicitly development-only, not vendor-supported or CVE-tracked. Those COPRs also note Open Robotics Fedora work is oriented around **Lyrical Luth**, not back-porting first-class Fedora binaries for Jazzy.
- **Lyrical does not magically make Fedora Tier 1 today:** Lyrical binary install docs list Ubuntu / RHEL 10 / Windows; Fedora remains largely source-build / community ([Lyrical installation](https://docs.ros.org/en/lyrical/Installation.html), [Lyrical release announcement](https://discourse.openrobotics.org/t/ros-2-lyrical-luth-released/55021)).
- **Concrete revisit triggers (any one):** (1) official Fedora binary packages from Open Robotics; (2) a Red Hat–blessed COPR / Fedora Robotics SIG path suitable for demos; (3) deliberate strategy change to **RHEL/UBI + official Jazzy RPMs** (available now).

**APPENG-5810 — rviz2 / desktop variant**

- **Park decision stands.** Official Docker guidance keeps `desktop` images separate because they pull heavy GUI deps; `osrf/ros:*-desktop*` is in the multi‑GB class vs leaner `ros-base` ([Docker Hub `library/ros`](https://hub.docker.com/_/ros), [osrf/ros desktop tags](https://hub.docker.com/r/osrf/ros/tags)).
- **Overlap with APPENG-5772 is partial:** browser Gazebo/noVNC covers simulation visualization for the demo; rviz2 remains useful for robot-state / TF / sensor debugging — decide after Story 2 whether a standalone desktop image is still needed.
- **Extra constraint on Fedora+Jazzy:** community Jazzy COPRs often **do not ship rviz2** (Ogre/Assimp build blockers); see [ros2-rpm known limitations](https://github.com/nickschuetz/ros2-rpm/blob/main/README.md). That makes “Fedora Jazzy + rviz2” doubly hard versus Ubuntu desktop images.

**Sources**

- [REP 2000 — ROS 2 releases and target platforms](https://reps.openrobotics.org/rep-2000/) (Jazzy: Ubuntu Noble Tier 1, RHEL 9 Tier 2; no Fedora)
- [ROS 2 Jazzy RHEL RPM install](https://docs.ros.org/en/jazzy/Installation/RHEL-Install-RPMs.html)
- [ROS 2 Lyrical installation](https://docs.ros.org/en/lyrical/Installation.html) / [Lyrical release announcement](https://discourse.openrobotics.org/t/ros-2-lyrical-luth-released/55021)
- [nickschuetz/ros2-rpm (COPR landscape + limitations)](https://github.com/nickschuetz/ros2-rpm)
- [Fedora Robotics SIG / fedros](https://gitlab.com/fedora/sigs/robotics/src/fedros)
- [Docker Hub official `ros` image (desktop kept separate)](https://hub.docker.com/_/ros)

---

### Story 2: Single robot simulation workflow — ⚪ Not Started

> Detail doc: [story2-simulation.md](stories/story2-simulation.md)

| Key | Parent | Issue Type | Created | Summary |
|-----|--------|------------|---------|---------|
| APPENG-5765 | APPENG-5763 | Story | 2026/07/16 | Single robot simulation workflow |

**Description:** Enable one-click launch of a ROS2 robot in Gazebo simulation from the extension. Provide browser-based visualization (noVNC or web streaming) so developers never touch a terminal. Include a basic topic inspection panel showing ROS2 messages flowing.

#### Sub-tasks

| Status | Key | Summary | Description |
|--------|-----|---------|-------------|
| ⚪ | APPENG-5771 | Container orchestration for ROS2 + Gazebo launch via Podman pod | Implement one-click launch of a ROS2 robot with Gazebo simulation running in a Podman pod, managed from the extension. |
| ⚪ | APPENG-5772 | Integrate noVNC or web-based video stream for simulation visualization | Provide browser-based visualization of the running Gazebo simulation so developers never need to touch a terminal or install GUI tools locally. |
| ⚪ | APPENG-5773 | Build topic monitor panel showing active ROS2 topics and message rates | Add a panel in the extension UI that displays active ROS2 topics, message types, and publishing rates for basic inspection without CLI tools. |

---

### Story 3: Multi-robot local scaling *(stretch)* — ⚪ Not Started

> Detail doc: [story3-multi-robot.md](stories/story3-multi-robot.md)

| Key | Parent | Issue Type | Created | Summary |
|-----|--------|------------|---------|---------|
| APPENG-5766 | APPENG-5763 | Story | 2026/07/16 | Multi-robot local scaling |

**Description:** Scale from one robot to a local fleet using Podman pods or Compose. Integrate Zenoh middleware for inter-robot communication across containers. Provide a fleet dashboard showing robot status and topic routing. (Stretch goal for MVP)

#### Sub-tasks

| Status | Key | Summary | Description |
|--------|-----|---------|-------------|
| ⚪ | APPENG-5774 | Podman Compose or pod-based multi-container orchestration for 2+ robots | Enable launching multiple robot containers locally using Podman Compose or pod-based orchestration, scaling from a single robot to a local fleet. |
| ⚪ | APPENG-5775 | Zenoh router and DDS bridge sidecar auto-configuration | Automatically configure Zenoh router and DDS bridge sidecars when scaling to multiple robots, enabling inter-robot communication across containers. |
| ⚪ | APPENG-5776 | Fleet status panel in the extension UI | Build a dashboard panel in the extension showing fleet-level status: robot count, individual robot state, and topic routing across the local fleet. |

---

### Story 4: OpenShift deployment bridge *(stretch)* — ⚪ Not Started

> Detail doc: [story4-openshift-bridge.md](stories/story4-openshift-bridge.md)

| Key | Parent | Issue Type | Created | Summary |
|-----|--------|------------|---------|---------|
| APPENG-5767 | APPENG-5763 | Story | 2026/07/16 | OpenShift deployment bridge |

**Description:** Export local Podman configuration to Kubernetes manifests. Enable optional Kind-based local cluster testing before pushing to OpenShift. Document the full laptop-to-cluster workflow. (Stretch goal for MVP)

#### Sub-tasks

| Status | Key | Summary | Description |
|--------|-----|---------|-------------|
| ⚪ | APPENG-5777 | Generate K8s manifests from running Podman pod configuration | Export the running Podman pod configuration as Kubernetes-compatible manifests, enabling the transition from local development to cluster deployment. |
| ⚪ | APPENG-5778 | Kind cluster integration for local validation | Enable deploying the generated K8s manifests to a local Kind cluster from the extension for validation before pushing to OpenShift. |
| ⚪ | APPENG-5779 | Getting-started guide for the full workflow | Write end-to-end documentation covering the full developer journey: installing the extension, launching a robot simulation, scaling to a fleet, and deploying to OpenShift. |

---

## Suggested Execution Order

Stories follow a natural dependency chain:

```
Story 1 (Scaffolding + images)  ──  Foundation; must be first
    │
    ▼
Story 2 (Single robot)          ──  Core demo flow; depends on shell + images
    │
    ▼
Story 3 (Multi-robot)           ──  Stretch; builds on single-robot orchestration
    │
    ▼
Story 4 (OpenShift bridge)      ──  Stretch; builds on working local workflows
```

| Priority | Scope | Issues |
|----------|--------|--------|
| **MVP-critical** (ROSCon demo) | Stories 1–2 | 6 sub-tasks (`APPENG-5768`–`5773`) |
| **Stretch** | Stories 3–4 | 6 sub-tasks (`APPENG-5774`–`5779`), including docs |

---

## Parallelization & Dependency Analysis

Now that the scaffold (APPENG-5768) is complete, sub-tasks have fine-grained dependencies at the task level, not just the story level. The diagram and tables below show what can run in parallel and what blocks what.

### Dependency Diagram

```
✅ APPENG-5768 (Scaffold) ── DONE, unblocks everything below
    │
    ├── APPENG-5769 (Base image)         ◀── independent, no code dependency
    ├── APPENG-5770 (Image catalog UI)   ◀── independent, can use mock data
    ├── APPENG-5808 (Wizard + sim images) ◀── wizard UI + TurtleBot3 Containerfile; feeds into 5771
    ├── APPENG-5773 (Topic monitor UI)   ◀── independent, can use mock data
    │
    └── APPENG-5771 (ROS2+Gazebo orchestration)  ◀── CRITICAL PATH; consumes wizard selections + sim image
            │
            ├── APPENG-5772 (noVNC/streaming)     ◀── needs running simulation
            ├── APPENG-5774 (Multi-robot)          ◀── scales from single robot
            │       │
            │       ├── APPENG-5775 (Zenoh/DDS)    ◀── needs multi-container
            │       └── APPENG-5776 (Fleet panel)  ◀── needs fleet running
            │
            └── APPENG-5777 (K8s manifests)        ◀── needs running pod config
                    │
                    └── APPENG-5778 (Kind cluster) ◀── needs manifests
                            │
                            └── APPENG-5779 (Docs) ◀── documents full workflow
```

### Ready Now (no blockers)

These can be picked up by team members immediately and worked on in parallel:

| Key | Summary | Skills needed |
|-----|---------|---------------|
| APPENG-5769 | Build Fedora + ROS2 Jazzy base image | Container builds, ROS2 packaging |
| APPENG-5770 | Image catalog UI | Svelte/TypeScript frontend |
| APPENG-5771 | ROS2 + Gazebo container orchestration | Podman pods, ROS2, Gazebo |
| APPENG-5773 | Topic monitor panel | Svelte/TypeScript frontend |

> A team of 3–4 people can work in parallel right now.

### Blocked — waiting on APPENG-5771 (critical path)

APPENG-5771 (container orchestration for a running single robot) is the **critical path item** — it unblocks the most downstream work. Prioritize assigning it first.

| Key | Summary | Blocked by | Reason |
|-----|---------|------------|--------|
| APPENG-5772 | noVNC/web streaming | 5771 | Needs a running Gazebo simulation to visualize |
| APPENG-5774 | Multi-robot orchestration | 5771 | Must scale from a working single-robot setup |
| APPENG-5777 | K8s manifest generation | 5771 | Needs a running Podman pod config to export |

### Blocked — deeper in the chain

| Key | Summary | Blocked by | Reason |
|-----|---------|------------|--------|
| APPENG-5775 | Zenoh/DDS auto-config | 5774 | Needs multi-container setup first |
| APPENG-5776 | Fleet status panel | 5774, 5775 | Needs fleet running to display status |
| APPENG-5778 | Kind cluster integration | 5777 | Needs generated manifests to deploy |
| APPENG-5779 | Getting-started guide | Most others | Documents the full end-to-end workflow |

### Miro Board

**Status:** Not yet created — create when 2+ people are actively working on this.

A Miro board would be useful for a team kickoff/planning session where people need to visualize the dependency graph, drag tasks, and claim work items interactively. Until then, the dependency diagram and tables above serve as the single source of truth to avoid sync drift between Miro, this doc, and Jira.

**TODO:** Create the Miro board when the team is ready to pick up parallel tasks.

---

## Summary Table (All 17 Issues)

| Status | Key | Issue Type | Parent | Summary |
|--------|-----|------------|--------|---------|
| 🟡 | APPENG-5763 | Epic | — | Podman Desktop Extension for Physical AI Robotics Development |
| ✅ | APPENG-5764 | Story | APPENG-5763 | Extension scaffolding and base image catalog |
| ⚪ | APPENG-5765 | Story | APPENG-5763 | Single robot simulation workflow |
| ⚪ | APPENG-5766 | Story | APPENG-5763 | Multi-robot local scaling |
| ⚪ | APPENG-5767 | Story | APPENG-5763 | OpenShift deployment bridge |
| ✅ | APPENG-5768 | Sub-task | APPENG-5764 | Scaffold Podman Desktop extension with TypeScript/Svelte boilerplate |
| ✅ | APPENG-5769 | Sub-task | APPENG-5764 | Build and publish ROS2 Jazzy base image to Quay |
| ✅ | APPENG-5770 | Sub-task | APPENG-5764 | Implement image catalog UI with pull and status indicators |
| ✅ | APPENG-5808 | Sub-task | APPENG-5764 | Project creation wizard and simulation image setup |
| ⚪ | APPENG-5771 | Sub-task | APPENG-5765 | Container orchestration for ROS2 + Gazebo launch via Podman pod |
| ⚪ | APPENG-5772 | Sub-task | APPENG-5765 | Integrate noVNC or web-based video stream for simulation visualization |
| ⚪ | APPENG-5773 | Sub-task | APPENG-5765 | Build topic monitor panel showing active ROS2 topics and message rates |
| ⚪ | APPENG-5774 | Sub-task | APPENG-5766 | Podman Compose or pod-based multi-container orchestration for 2+ robots |
| ⚪ | APPENG-5775 | Sub-task | APPENG-5766 | Zenoh router and DDS bridge sidecar auto-configuration |
| ⚪ | APPENG-5776 | Sub-task | APPENG-5766 | Fleet status panel in the extension UI |
| ⚪ | APPENG-5777 | Sub-task | APPENG-5767 | Generate K8s manifests from running Podman pod configuration |
| ⚪ | APPENG-5778 | Sub-task | APPENG-5767 | Kind cluster integration for local validation |
| ⚪ | APPENG-5779 | Sub-task | APPENG-5767 | Getting-started guide for the full workflow |
| 🅿️ | APPENG-5809 | Sub-task | APPENG-5764 | Migrate ROS2 Jazzy base image from Ubuntu to Fedora |
| 🅿️ | APPENG-5810 | Sub-task | APPENG-5764 | Add rviz2/desktop variant of the base image |

---

## Decisions and Directions (APPENG-5768 Scaffolding)

Captured during initial scaffold implementation.

### Questions and Answers

| # | Question | Answer |
|---|----------|--------|
| 1 | Reference project for extension structure? | Official [full template](https://github.com/podman-desktop/podman-desktop-extension-full-template) — 3-package architecture (frontend/backend/shared) |
| 2 | Extension naming convention? | `physical-ai` (lowercase, hyphenated) — matches existing extensions (e.g., `kube-context`, `kubectl-cli`). Can be refactored later. |
| 3 | Project directory? | `podman-work/physical-ai/` — new folder with extension name |
| 4 | Package manager? | npm with workspaces — matches the full template |
| 5 | Min Podman Desktop version? | `>=1.28.0` (user's current version) |
| 6 | Include RPC bridge from start? | Yes — avoids retrofit when image catalog and simulation work need frontend-backend communication |

### Key Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Template | Full template (3-package) | Extension will have substantial UI (catalog, dashboards, panels) |
| Extension name | `physical-ai` | Matches existing naming convention |
| Display name | `Physical AI` | Clean, matches the Jira epic |
| Publisher | `redhat` | Red Hat is the publishing org |
| License | Apache-2.0 | Matches all existing Podman Desktop extensions |
| Build tooling | Vite 8 + Vitest 4 | Matches current template versions |
| Frontend framework | Svelte 5 + TailwindCSS | Template default, uses `@podman-desktop/ui-svelte` |
| Routing | tinro (hash mode) | Template default for webview-based extensions |
| `.npmrc` | `legacy-peer-deps=true` | Required due to peer dep mismatches between eslint plugins and typescript-eslint v8 |

### References

- [Developing extensions guide](https://podman-desktop.io/docs/extensions/developing)
- [Extension templates](https://podman-desktop.io/docs/extensions/templates)
- [Full template repo](https://github.com/podman-desktop/podman-desktop-extension-full-template)
- [Existing built-in extensions](https://github.com/podman-desktop/podman-desktop/tree/main/extensions)

---

## Wishlist / Good to Have

Items that improve polish or operability but are **not** required for the ROSCon MVP. Promote to a tracked sub-task when someone picks them up.

| Status | Area | Item | Notes |
|--------|------|------|-------|
| 💡 | Build / push UI | **Download full build log** | Build/push progress in the UI keeps only the newest ~500 log lines (memory safety). A true “Download full log” needs uncapped logs written to a temp file during the build, plus a download action and cleanup on cancel/complete/reload. Do **not** expose a Settings toggle for “full vs capped” display — prefer download of the full file when this is implemented. |
| 💡 | Build / push UI | Persist progress across extension reload | Progress Maps are in-memory today; reloading the extension clears build/push/pull state. Nice-to-have later if long builds + reload becomes a common pain. |

> **Legend:** 💡 Wishlist · promote to 🅿️ follow-up or a Jira sub-task when scheduled

---

## Notes on this version

- **Summaries** match Jira exactly (sentence case); section labels add *(stretch)* only as plan metadata, not as part of the Summary field.
- **Parent** is always the parent issue **Key** (not the parent summary text from the Jira export UI).
- **Created** is date-only for readability; Jira timestamps are 2026/07/16 11:53–11:54 PM.
- Epic Description is cleaned slightly from Jira (typo fix: “containers”; numbered drivers) while preserving meaning.
