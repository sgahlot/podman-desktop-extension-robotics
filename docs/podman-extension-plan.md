# Podman Desktop Extension for Physical AI Robotics Development — Plan

> Derived from Jira export.  
> Fields used: **Parent**, **Key**, **Issue Type**, **Created**, **Description**, **Summary**.  
> Keys and Summaries are unique across all 17 issues.

## Overview

Build a Podman Desktop extension that gives robotics developers a GUI-driven path from local development to OpenShift deployment. Target audience: robotics engineers unfamiliar with containers, CLI, or enterprise Linux. The extension provides curated ROS2 base and simulation images (Ubuntu interim today; Fedora/RHEL path parked), one-click simulation launch (Story 2), and a bridge toward cluster deployment.

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

**Description:** Build a Podman Desktop extension that gives robotics developers a GUI-driven path from local development to OpenShift deployment. Target audience: robotics engineers unfamiliar with containers, CLI, or enterprise Linux. The extension provides ROS2 base and simulation images (Ubuntu interim today; Fedora/RHEL path parked), one-click simulation launch (Story 2), and a bridge toward cluster deployment. MVP targeting ROSCon Toronto demo in September 2026.

Drivers:
1. Push the workloads to OpenShift and the Red Hat ecosystem
2. Give a clear path from Ubuntu builds on laptops to Fedora and eventually RHEL containers
3. Bridge the large gap from robotics lab projects to hardened full-scale production deployment on OpenShift

---

## Progress Overview

| Story | Summary | Status | Sub-tasks |
|-------|---------|--------|-----------|
| [APPENG-5764](#story-1) | Extension scaffolding and base image catalog | ✅ Done | 4/4 done, 2 follow-ups parked |
| [APPENG-5765](#story-2) | Single robot simulation workflow | 🟡 In Progress | Original + Topic Monitor done; APPENG-5920/5922/5923 **In Review**; APPENG-5980/5981 **New** |
| [APPENG-5766](#story-3) | Multi-robot local scaling | ⚪ Not Started | 0/3 done |
| [APPENG-5767](#story-4) | OpenShift deployment bridge | ⚪ Not Started | 0/3 done |
| [Spike](#story-5) | Local-first deployment of reference demos | 🅿️ Parked (Kind OOM) | 0/6 proposed |
| [Story 6](#story-6) | Podman-only simulation workflow (ROSCon demo) | 🟡 In Progress | 5/6 done — **demo path complete; S6-6 deferred** |
| [FIX](#fix-arch-aware-sim) | Make simulation image build arch-aware | ✅ Done | Naming + labels fixed; GPU passthrough + Sensors re-enabled (2026-08) |
| [Security](#security-hardening) | Security hardening | ✅ Done | Shell injection, exec/launch lockdown, image trust, defense-in-depth + follow-up fixes |

> **Legend:** ✅ Done · 🟠 In Review · 🟡 In Progress / Almost Done · ⚪ Not Started · 🅿️ Parked · 🔴 Must fix

**Last updated:** 2026-08-11

---

## Work Breakdown

<a id="story-1"></a>

### Story 1: Extension scaffolding and base image catalog — ✅ Done

> Detail doc: [story1-scaffolding.md](stories/story1-scaffolding.md)

| Key | Parent | Issue Type | Created | Summary |
|-----|--------|------------|---------|---------|
| APPENG-5764 | APPENG-5763 | Story | 2026/07/16 | Extension scaffolding and base image catalog |

**Description:** Build the Podman Desktop extension shell (registration, navigation, branding). Integrate a catalog of ROS2 base/simulation images pullable from Quay (Ubuntu interim bases today; Fedora/RHEL path parked). Include an Image Builder to select robot type, middleware (Zenoh/DDS), and simulation engine, then build/push base and simulation images.

#### Sub-tasks

| Status | Key | Summary | Description |
|--------|-----|---------|-------------|
| ✅ | APPENG-5768 | Scaffold Podman Desktop extension with TypeScript/Svelte boilerplate | Set up the Podman Desktop extension project structure, registration, and basic navigation shell. |
| ✅ | APPENG-5769 | Build and publish ROS2 Jazzy base image to Quay | Ubuntu 24.04 interim (`ros:jazzy-ros-base`). Build/push via Image Builder Phase 1. Follow-ups parked (5809/5810). |
| ✅ | APPENG-5770 | Implement image catalog UI with pull and status indicators | Browse Quay namespace; All (default) or Curated view; allowlist in Preferences; pull + local status. |
| ✅ | APPENG-5808 | Project creation wizard and simulation image setup | Image Builder: two-phase build (Humble base+sim; Jazzy base + arm64 sim). TurtleBot3 + Gazebo. Persist selections for Story 2 / Story 6. |

##### APPENG-5808 Implementation Parts

| Status | Part | Summary |
|--------|------|---------|
| ✅ | Part 1 | Simulation + base Containerfiles under `packages/backend/assets/` (`ros2-humble-base`, `ros2-humble-turtlebot3`, `ros2-jazzy-base`, `ros2-jazzy-sim`) |
| ✅ | Part 2 | Image Builder UI — dropdowns for robot/distro/middleware/engine/base preset; Dashboard card first; prefs persistence |
| ✅ | Part 3 | Wire Build & Push — Phase 1 base + Phase 2 simulation (`FROM` local base); progress/cancel/push |

##### Why two-phase build (base + simulation)?

The Image Builder splits the build into a **base image** (Phase 1) and a **simulation image** (Phase 2) that layers on top via `FROM $LOCAL_BASE_IMAGE`. This is a practical optimization, not a hard technical requirement — a single Containerfile would work.

| Benefit | Detail |
|---------|--------|
| **Build speed** | The base image (ROS2 core, ~1–2 GB of apt packages) rarely changes. When you modify an entrypoint, world file, or noVNC config, only the sim layer rebuilds (~5 min) instead of the full ROS2 install (~15–20 min). |
| **Shared foundation** | Multiple sim images share the same base. Today: Humble base + Humble TurtleBot3 sim, Jazzy base + Jazzy arm64 sim. Future robot types layer on the same base without rebuilding ROS2. |
| **Smaller pushes** | If the base is already on Quay, pushing a new sim variant only transfers the diff layers (Gazebo + Nav2 + noVNC), not the entire ROS2 stack. |
| **Non-simulation use** | The base image works standalone for headless ROS2 development, CI pipelines, or robots that don't need Gazebo/noVNC. |

If you only ever build one sim image and never reuse the base, the two-phase split is overhead for no gain. It pays off with multiple images sharing a common ROS2 layer or frequent iteration on the sim layer.

##### Story 1 publish checklist (golden Quay images)

| Tag | Role |
|-----|------|
| `quay.io/<ns>/ros2-humble-base:sloretz` | Mac / multi-arch Humble base |
| `quay.io/<ns>/ros2-humble-base:osrf` | Linux amd64 Humble base |
| `quay.io/<ns>/ros2-jazzy-base:latest` | Jazzy headless base (amd64 preset) |
| `quay.io/<ns>/ros2-jazzy-base:noble` | Jazzy base for arm64 Quick Start / Story 6 |
| `quay.io/<ns>/ros2-humble-turtlebot3:sloretz` | Humble sim (layered on sloretz base) |
| `quay.io/<ns>/ros2-jazzy-sim:noble` | Jazzy sim + noVNC (multi-arch; Story 6) |

##### Future (not blocking Story 1)

- **Additional robot types** beyond TurtleBot3 — same Image Builder pattern (`SimulationProfiles` + `assets/ros2-humble-<robot>/` + curated allowlist entry). Spike package availability on Humble (e.g. TurtleBot4) before enabling UI options.
- Simulation **launch** wizard — ✅ implemented via Story 6 (APPENG-5771/5772 done).
- **Humble + noVNC / Mac Simulation parity** — time-permitting; see [Wishlist](#wishlist--good-to-have). Today Quick Start and Story 6 UX are Jazzy-only; Humble builds on Mac via `sloretz` but lacks the browser display stack.

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

<a id="story-2"></a>

### Story 2: Single robot simulation workflow — 🟡 In Progress (5771–5773 done; 5920/5922/5923 In Review; 5980/5981 New)

> Detail doc: [story2-simulation.md](stories/story2-simulation.md)

| Key | Parent | Issue Type | Created | Summary |
|-----|--------|------------|---------|---------|
| APPENG-5765 | APPENG-5763 | Story | 2026/07/16 | Single robot simulation workflow |

**Description:** Enable one-click launch of a ROS2 robot in Gazebo simulation from the extension. Provide browser-based visualization (noVNC or web streaming) so developers never touch a terminal. Include a basic topic inspection panel showing ROS2 messages flowing.

#### Sub-tasks

| Status | Key | Summary | Description |
|--------|-----|---------|-------------|
| ✅ | APPENG-5771 | Container orchestration for ROS2 + Gazebo launch via Podman pod | Implemented via [Story 6](stories/story6-podman-sim.md) S6-1/S6-3/S6-4. Podman-only (no pods/compose): backend lifecycle API + Simulation page + one-click launch. |
| ✅ | APPENG-5772 | Integrate noVNC or web-based video stream for simulation visualization | Implemented via [Story 6](stories/story6-podman-sim.md) S6-1/S6-4. noVNC stack (Xvfb + x11vnc + websockify) in sim image, "Open in Browser" on Simulation page. |
| ✅ | APPENG-5773 | Build topic monitor panel showing active ROS2 topics and message rates | Topic Monitor page (`/topics`): lists active ROS2 topics with message types, publisher/subscriber counts. Uses `podman exec` (attached) to run `ros2 topic list` + `ros2 topic info` inside the simulation container. Auto-refreshes every 5s. Accessible from Dashboard card and Simulation page "View Topics" button. Hz measurement deferred. |
| 🟠 | APPENG-5920 | Add navigation UI for driving robots in simulation | **In Review.** Per-robot X/Y + **Go** on Simulation page. Local/Mac: `cmd_vel` turn/drive (lidar/IMU publish; Nav2 stack not launched — no obstacle avoidance). OpenShift Nav2 (`navigate_to_pose`) deferred. |
| 🟠 | APPENG-5922 | Topic Monitor drill-down | **In Review.** Expandable rows: `ros2 topic info -v` pub/sub node names. On-demand fetch (not polled). |
| 🟠 | APPENG-5923 | Topic Monitor message peek | **In Review.** Peek via `ros2 topic echo --once` (1–30s timeout); Tree/Raw, Copy, schema, topology badges. |
| ⚪ | APPENG-5980 | Local Nav2 feasibility spike on Apple Silicon (Mac) | **New.** Timeboxed feasibility spike for local Nav2 on Mac: run matrix (llvmpipe / GPU passthrough), validate sensor + planner/controller stability, and deliver go/no-go with constraints. |
| ⚪ | APPENG-5981 | Wire Simulation Go to local Nav2 (`navigate_to_pose`) | **In progress.** Backend launches Nav2 on Go, sends map-frame goals; UI status Navigating/Reached. Manual tb3_sandbox demo pending. |

---

<a id="story-3"></a>

### Story 3: Multi-robot local scaling — ⚪ Not Started

> Detail doc: [story3-multi-robot.md](stories/story3-multi-robot.md)
>
> **Approach (2026-08-10):** **Podman Compose** is the Story 3 orchestration path (APPENG-5774). Single-container multi-spawn (Story 6) remains a lightweight demo only — it does not complete this story. Zenoh (5775) and fleet panel (5776) follow Compose.

| Key | Parent | Issue Type | Created | Summary |
|-----|--------|------------|---------|---------|
| APPENG-5766 | APPENG-5763 | Story | 2026/07/16 | Multi-robot local scaling |

**Description:** Scale from one robot to a local fleet using Podman pods or Compose. Integrate Zenoh middleware for inter-robot communication across containers. Provide a fleet dashboard showing robot status and topic routing.

#### Sub-tasks

| Status | Key | Summary | Description |
|--------|-----|---------|-------------|
| ⚪ | APPENG-5774 | Podman Compose multi-container orchestration for 2+ robots | **Podman Compose** fleet: Gazebo/noVNC + robot services (Zenoh-ready). Extension start/stop/scale via Compose. |
| ⚪ | APPENG-5775 | Zenoh router and DDS bridge sidecar auto-configuration | Zenoh for cross-container DDS (and OpenShift CNI parity) after Compose topology exists. |
| ⚪ | APPENG-5776 | Fleet status panel in the extension UI | Fleet dashboard over Compose-managed services/containers. |

---

<a id="story-4"></a>

### Story 4: OpenShift deployment bridge — ⚪ Not Started

> Detail doc: [story4-openshift-bridge.md](stories/story4-openshift-bridge.md)

| Key | Parent | Issue Type | Created | Summary |
|-----|--------|------------|---------|---------|
| APPENG-5767 | APPENG-5763 | Story | 2026/07/16 | OpenShift deployment bridge |

**Description:** Export local Podman configuration to Kubernetes manifests. Enable optional Kind-based local cluster testing before pushing to OpenShift. Document the full laptop-to-cluster workflow.

#### Sub-tasks

| Status | Key | Summary | Description |
|--------|-----|---------|-------------|
| ⚪ | APPENG-5777 | Generate K8s manifests from running Podman pod configuration | Export the running Podman pod configuration as Kubernetes-compatible manifests, enabling the transition from local development to cluster deployment. |
| ⚪ | APPENG-5778 | Kind cluster integration for local validation | Deploy generated (or hand-written lean) manifests to Kind. Prefer a **single-sim Deployment** of `ros2-jazzy-sim` first (Story 6 parity); multi-pod Nav2 charts remain a later / heavier path. See Story 5 revisit note (2026-08-10). |
| ⚪ | APPENG-5779 | Getting-started guide for the full workflow | Write end-to-end documentation covering the full developer journey: installing the extension, launching a robot simulation, scaling to a fleet, and deploying to OpenShift. |

---

## Suggested Execution Order

Stories follow a natural dependency chain:

```
Story 1 (Scaffolding + images)  ──  Foundation; must be first  ✅
    │
    ├── Story 6 (Podman-only sim) ──  ROSCon demo path  🟡 (S6-1–S6-5 done)
    │       └── Implements Story 2 core (APPENG-5771 / 5772)
    │
    ├── Story 5 (Reference demo spikes → internalize)  🅿️ Parked (Kind OOM on arm64)
    │       │       Branch: spike/repo-b-kind-attempt — resume later for K8s/OpenShift
    │       ├── S5-1/S5-2  spike local Kind/Minikube
    │       ├── S5-3       internalize: own Containerfiles, Helm, Zenoh configs
    │       ├── S5-4       catalog our images
    │       └── S5-5/S5-6  deploy-to-local + OpenShift wizards ──► feeds Stories 3–4
    │
    ├── Story 2 (Single robot)  ──  🟡 In Progress (5771–5773 done; 5920/5922/5923 In Review)
    │       ▼
    │   Story 3 (Multi-robot)   ──  Stretch; Repo A (OpenRMF) + Repo B (Zenoh) inform this
    │
    └── Story 4 (OpenShift bridge)  ──  Stretch; both repos have Helm→OpenShift today
```

| Priority | Scope | Issues |
|----------|--------|--------|
| **MVP-critical** (ROSCon demo) | Stories 1 + 6 (+ Story 2 via 5771/5772) | Image Builder, Catalog, Simulation launch/spawn/noVNC |
| **🟠 Story 2 sub-tasks In Review** | APPENG-5920 + 5922 + 5923 | Local Go (`cmd_vel`), Topic drill-down, Peek — pending review |
| **Parked** | Story 5 | Kind spike; resume for K8s/OpenShift path |
| **Stretch** | Stories 3–4 | 6 sub-tasks (`APPENG-5774`–`5779`), including docs |

---

## Parallelization & Dependency Analysis

Now that the scaffold (APPENG-5768) is complete, sub-tasks have fine-grained dependencies at the task level, not just the story level. The diagram and tables below show what can run in parallel and what blocks what.

### Dependency Diagram

```
✅ APPENG-5768 (Scaffold) ── DONE, unblocks everything below
    │
    ├── ✅ APPENG-5769 (Base image)
    ├── ✅ APPENG-5770 (Image catalog UI)
    ├── ✅ APPENG-5808 (Wizard + sim images)
    ├── ✅ APPENG-5773 (Topic monitor UI) ── DONE
    │       ├── 🟠 APPENG-5922 (Topic drill-down)    ◀── IN REVIEW
    │       └── 🟠 APPENG-5923 (Topic message peek)  ◀── IN REVIEW
    ├── 🟠 APPENG-5920 (Nav Go UI / cmd_vel) ── IN REVIEW (OpenShift Nav2 deferred)
    │
    ├── 🅿️ S5-1…S5-6 (Story 5 Kind/OpenShift spike) ── PARKED (branch spike/repo-b-kind-attempt)
    │
    └── ✅ APPENG-5771 (ROS2+Gazebo orchestration) ── DONE via Story 6
            │
            ├── ✅ APPENG-5772 (noVNC/streaming)   ── DONE via Story 6
            ├── APPENG-5774 (Multi-robot)          ◀── UNBLOCKED, scales from single robot
            │       │
            │       ├── APPENG-5775 (Zenoh/DDS)    ◀── needs multi-container; S5-6 informs
            │       └── APPENG-5776 (Fleet panel)  ◀── needs fleet running; Repo A (OpenRMF) informs
            │
            └── APPENG-5777 (K8s manifests)        ◀── UNBLOCKED, needs running container config; S5-5 informs
                    │
                    └── APPENG-5778 (Kind cluster) ◀── needs manifests; S5-4 informs
                            │
                            └── APPENG-5779 (Docs) ◀── documents full workflow
```

### Ready Now (no blockers)

Stories 1 and 6 (S6-1–S6-5) are complete for the ROSCon **demo path**; S6-6 (Customize Hardware) remains stretch/deferred. Story 2 original sub-tasks done; APPENG-5920 / 5922 / 5923 are **In Review**. [Security hardening](#security-hardening) complete. The [arch-aware sim fix](#fix-arch-aware-sim) has landed. Next pick-ups:

| Key | Summary | Skills needed |
|-----|---------|---------------|
| APPENG-5774 | Multi-robot via **Podman Compose** | Compose services + extension launch/scale; Zenoh next |
| APPENG-5777 | K8s manifest generation | Start from single-container Deployment (not multi-pod export) |
| Kind lean spike | One `ros2-jazzy-sim` pod on Kind + port-forward | Packaging dry-run; not full Story 4/5 |
| OpenShift spike | Sensors + Nav2 in-cluster (manual) | `oc`, Sensors-on world, `navigate_to_pose`, CPU first |
| S6-6 | Customize Hardware card *(stretch — deferred)* | Xacro parametric, podman exec |

**Parked (not ready-now):** Story 5 multi-pod Kind (Repo B) — OOM on arm64. **Revisit** with lean single-sim Kind before restoring multi-pod charts.

**Story 1 follow-ons (optional polish):** additional robot types in Image Builder; curated Catalog demos against published golden Quay tags.

### ~~Blocked — waiting on APPENG-5771~~ — RESOLVED

APPENG-5771 and APPENG-5772 are **done** (via Story 6). The following items are now **unblocked**:

| Key | Summary | Previously blocked by | Now |
|-----|---------|----------------------|-----|
| ✅ APPENG-5772 | noVNC/web streaming | 5771 | Done (Story 6 S6-1/S6-4) |
| APPENG-5774 | Multi-robot orchestration | 5771 | **Unblocked** — can start now, scales from single-robot Story 6 setup |
| APPENG-5777 | K8s manifest generation | 5771 | **Unblocked** — can export from running Podman container config |

### Blocked — waiting on downstream work

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
| ✅ | APPENG-5765 | Story | APPENG-5763 | Single robot simulation workflow |
| ⚪ | APPENG-5766 | Story | APPENG-5763 | Multi-robot local scaling |
| ⚪ | APPENG-5767 | Story | APPENG-5763 | OpenShift deployment bridge |
| ✅ | APPENG-5768 | Sub-task | APPENG-5764 | Scaffold Podman Desktop extension with TypeScript/Svelte boilerplate |
| ✅ | APPENG-5769 | Sub-task | APPENG-5764 | Build and publish ROS2 Jazzy base image to Quay |
| ✅ | APPENG-5770 | Sub-task | APPENG-5764 | Implement image catalog UI with pull and status indicators |
| ✅ | APPENG-5808 | Sub-task | APPENG-5764 | Project creation wizard and simulation image setup |
| ✅ | APPENG-5771 | Sub-task | APPENG-5765 | Container orchestration for ROS2 + Gazebo launch via Podman pod |
| ✅ | APPENG-5772 | Sub-task | APPENG-5765 | Integrate noVNC or web-based video stream for simulation visualization |
| ✅ | APPENG-5773 | Sub-task | APPENG-5765 | Build topic monitor panel showing active ROS2 topics and message rates |
| 🟠 | APPENG-5920 | Sub-task | APPENG-5765 | Add navigation UI for driving robots in simulation |
| 🟠 | APPENG-5922 | Sub-task | APPENG-5765 | Topic Monitor drill-down |
| 🟠 | APPENG-5923 | Sub-task | APPENG-5765 | Topic Monitor message peek |
| ⚪ | APPENG-5980 | Sub-task | APPENG-5765 | Local Nav2 feasibility spike on Apple Silicon (Mac) |
| ⚪ | APPENG-5981 | Sub-task | APPENG-5765 | Wire Simulation Go to local Nav2 (`navigate_to_pose`) |
| ⚪ | APPENG-5774 | Sub-task | APPENG-5766 | Podman Compose multi-container orchestration for 2+ robots |
| ⚪ | APPENG-5775 | Sub-task | APPENG-5766 | Zenoh router and DDS bridge sidecar auto-configuration |
| ⚪ | APPENG-5776 | Sub-task | APPENG-5766 | Fleet status panel in the extension UI |
| ⚪ | APPENG-5777 | Sub-task | APPENG-5767 | Generate K8s manifests from running Podman pod configuration |
| ⚪ | APPENG-5778 | Sub-task | APPENG-5767 | Kind cluster integration for local validation |
| ⚪ | APPENG-5779 | Sub-task | APPENG-5767 | Getting-started guide for the full workflow |
| 🅿️ | S5-1 | Sub-task | Story 5 | Spike: run Repo B (multi-robot TurtleBot3) locally on Mac |
| 🅿️ | S5-2 | Sub-task | Story 5 | Spike: run Repo A (OpenRMF demos) locally on Mac |
| 🅿️ | S5-3 | Sub-task | Story 5 | Internalize: own Containerfiles, Helm charts, entrypoints, Zenoh configs |
| 🅿️ | S5-4 | Sub-task | Story 5 | Catalog internalized images in Image Catalog |
| 🅿️ | S5-5 | Sub-task | Story 5 | Extension: deploy-to-local wizard (Kind / Minikube) |
| 🅿️ | S5-6 | Sub-task | Story 5 | Extension: deploy-to-OpenShift path |
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

<a id="story-5"></a>

## Story 5: Local-first deployment of reference demos — 🅿️ Parked (Kind OOM)

> **No Jira keys yet.** Create tasks when work resumes.
>
> **Status (2026-07-28):** Kind spike parked on branch `spike/repo-b-kind-attempt` after Nav2 OOMKill (~4 Gi) on arm64. **Story 6** is the ROSCon Podman-only path. Resume Story 5 when tackling K8s / OpenShift.
>
> **Revisit note (2026-08-10):** The Kind OOM was from a **multi-pod** layout (control plane + Gazebo + per-robot Nav2 + Zenoh) with high memory requests — not from Kind itself. A **lean Kind spike** can mirror Story 6: **one** Deployment/Pod running `ros2-jazzy-sim` (Gazebo + noVNC + in-image spawn via `kubectl exec`), NodePort/`kubectl port-forward` for 6080, `kind load` for the image. Kind still adds API-server/etcd overhead (and on Mac often VM → Kind → pod), so budget more RAM than bare Podman (~5.7 GB), but a single-sim pod is far more realistic than Repo B’s chart. Nav2 stack launch remains a separate wiring step. Prefer this packaging spike before full multi-pod Helm or APPENG-5778.
>
> **Research note (2026-07-27):** Both reference repos were reviewed independently against this story. Goal and ownership model are sound; details below incorporate corrections (especially Repo A distro) and Mac/Kind spike risks that were previously under-specified.

### Goal

Two existing OpenShift-targeted demo repos already run Physical AI workloads (Gazebo, Nav2, Zenoh, OpenRMF). The goal is to:

1. **Run them locally** on a Mac (Kind or Minikube or plain Podman pods) — proving the local dev loop.
2. **Integrate with our extension** so demos deploy with minimal manual steps (local first, then OpenShift).
3. **Preserve the OpenShift path** — dual-target Helm (or values profiles) so the same owned charts work on Kind/Minikube and OpenShift.

This bridges Story 2 (single-robot sim) and Story 4 (OpenShift bridge) by learning from working demos, then **owning** the stack.

**Ownership model:** Reference repos are **learning material only** — no runtime dependency after the spikes. Internalize Helm charts, Containerfiles, entrypoints, Zenoh configs, noVNC patterns, and demo scripts into our repo (`packages/backend/assets/` and/or a top-level `deploy/`). We own build, catalog, and deploy.

**Relation to Story 1 / Story 6:** Story 1 golden images include Humble (TB3 sim) and Jazzy base + `ros2-jazzy-sim:noble`. Story 6 already shipped APPENG-5771/5772 on Podman using spike learnings — Story 5 internalization (S5-3) is **not** required for that path. Resume Story 5 for Kind/Helm/OpenShift; converge images/distros when those spikes decide what to keep.

### Reference Repos

#### Repo A: `rhkp/openrmf-demos-on-openshift`

- **URL:** <https://github.com/rhkp/openrmf-demos-on-openshift>
- **Stack (as of research):** ROS 2 **Jazzy** (`docker.io/osrf/ros:jazzy-desktop`), `ros-jazzy-rmf-dev`, `rmw_zenoh_cpp`, OpenRMF demos (`open-rmf/rmf_demos` **jazzy** branch), Gazebo via RMF demos, noVNC, RMF Web dashboard  
  > Earlier README wording said Humble; **`common/Dockerfile` is Jazzy** — use the Dockerfile as source of truth.
- **Demos:** Office, Hotel, Airport — each with Helm under `<demo>/helm/`
- **Images:** Podman build → Quay; shared `common/Dockerfile`; separate noVNC / zenoh-router / rmf-web-zenoh images under `common/`
- **Common layer:** Helm library `common/helm/openrmf-lib` (RMF Web, noVNC, zenoh-router templates)
- **Local validation:** `office/run-podman-local.sh` + `office/PODMAN-VALIDATION.md` — multi-container Podman (host network); docs target **Linux x86_64, ≥16 GiB RAM** (xrdp/GUI optional). Not a Mac Kind path out of the box.
- **Deployment:** `deploy-openshift.sh` per demo; optional OpenShift SCCs / ImageStream under `common/openshift/`
- **Access pattern to copy:** `rmfWeb.routes.enabled: false` + `port-forward.sh` (local-friendly). Prefer this over Routes for Kind.
- **Key tech:** OpenRMF fleet management, patrol dispatch, optional robot-as-pod + fleet coordinator, Zenoh for RMF Web / cross-component messaging

#### Repo B: `jianrongzhang89/robots-demo-platform-openshift`

- **URL:** <https://github.com/jianrongzhang89/robots-demo-platform-openshift>
- **Stack:** ROS 2 Jazzy, Gazebo Harmonic, Nav2, TurtleBot3 Waffle, noVNC
- **Base:** Fedora 43 + **COPR** ROS Jazzy packages (`tavie/ros2`) — supply-chain risk when internalizing; decide pin/rebuild vs keep COPR in S5-3
- **Architecture:** Dedicated `zenoh-router` + `gazebo-sim` + N× `robot-nav-*`; **zenoh-bridge-ros2dds** sidecars (client → `tcp/zenoh-router:7447`); multicast scouting **disabled**
- **Build caveat:** `make build` uses **`--platform linux/amd64`** — on Apple Silicon this implies QEMU/emulation for Gazebo (major Mac spike risk)
- **Deployment:** Single Helm chart `helm/multi-robot-demo/`; Makefile (`build-push`, `deploy`, `demo`, `reset`) heavily uses **`oc`** (OpenShift CLI)
- **Exposure:** OpenShift **Routes** for noVNC/web — will not apply on Kind without adaptation (Ingress / NodePort / port-forward)
- **Scaling:** `values.yaml` `robots:` list → one Nav2 Deployment + sidecar per robot
- **Demo:** `demo/meet_demo.py` (Nav2 Simple Commander — robots swap positions)
- **Resources (order of magnitude):** Gazebo ~4–8 CPU / 4–8 Gi; each Nav2 ~2–4 CPU / 2–4 Gi — size Docker Desktop / Kind node accordingly
- **GPU:** `gazebo.gpu=true` for NVIDIA nodes on OpenShift; on Mac Podman, virtio-gpu via `/dev/dri` passthrough (default on arm64)

### Why Zenoh (both repos)

OpenShift CNI (e.g. OVN-Kubernetes) blocks DDS multicast across pods. Pattern to internalize: **DDS stays localhost inside each pod; Zenoh TCP bridges cross-pod topics** (Repo B: `zenoh-bridge-ros2dds` sidecars + router; Repo A: zenoh-router + `rmw_zenoh_cpp` for RMF Web / related paths).

### Sub-tasks (proposed, no Jira yet)

| Status | ID | Summary | Description |
|--------|-----|---------|-------------|
| 🅿️ | S5-1 | Spike: run Repo B locally on Mac | Start here (simpler: one Containerfile, one chart). Build with Podman; deploy to **Kind** (preferred) or Minikube. Adapt: gate/remove Routes; use port-forward/NodePort/Ingress; `kubectl` instead of `oc`; load images via `kind load` / Minikube image load (no Quay required for local). Document amd64-on-arm64, RAM/CPU, DDS/Zenoh, noVNC. **Attempted — parked (Nav2 OOM on arm64).** |
| 🅿️ | S5-2 | Spike: run Repo A (office) locally on Mac | First try `office/run-podman-local.sh` (or headless + noVNC). Then Helm → Kind/Minikube with `routes.enabled=false` + port-forward. Document OpenRMF, RMF Web, fleet monitor/dispatch, SCCs (N/A on Kind). |
| 🅿️ | S5-3 | Internalize: own Containerfiles, Helm, entrypoints, Zenoh, demos | Copy/adapt learnings into `deploy/` and/or `packages/backend/assets/`. Dual-target charts (local K8s vs OpenShift). No runtime dependency on reference repos. Resolve COPR vs owned packages for any Fedora/Jazzy image we keep. |
| 🅿️ | S5-4 | Catalog internalized images | Push to our Quay namespace; curated allowlist patterns; verify Catalog pull + local status. |
| 🅿️ | S5-5 | Extension: deploy-to-local wizard | Select demo → detect Kind/Minikube/Podman → `helm upgrade --install` with **our** charts; expose noVNC URL (port-forward helper). |
| 🅿️ | S5-6 | Extension: deploy-to-OpenShift path | Same wizard against authenticated OpenShift (Routes, pull secrets). Feeds Story 4 (APPENG-5767 / 5777 / 5778). |

### Spike exit criteria

| ID | Done when |
|----|-----------|
| **S5-1** | Cluster shows zenoh-router + gazebo + both nav pods Ready (or documented hard blocker); noVNC reachable from the Mac browser; `meet_demo` succeeds **or** failure modes written up (arch/emulation, OOM, Zenoh disconnect). |
| **S5-2** | Office sim starts; fleet monitor sees robots; patrol dispatch succeeds (or documented blocker); optional RMF Web via port-forward. |
| **S5-3** | Owned artifacts land in-repo; reference repos are docs/history only; `helm template` works for `target: kind` and `target: openshift` (or equivalent values files). |

### Artifacts to internalize (checklist for S5-3)

| Artifact | Source pattern | Notes |
|----------|----------------|-------|
| App Containerfile(s) | Repo B single image dual-entrypoint; Repo A shared Jazzy+RMF image | Prefer pin digests; avoid fragile COPR long-term |
| Entrypoints | `entrypoint-gazebo.sh`, `entrypoint-nav2.sh`; RMF launch/scripts | |
| Zenoh router Deployment + config | Both repos | Stable ClusterIP `:7447` |
| Zenoh bridge sidecar configs (`json5`) | Repo B | Client mode, retry, multicast off |
| noVNC / web Services | Both | Local: port-forward; OpenShift: Routes |
| Helm chart(s) + values schema | Repo B N-robot list; Repo A per-world + library chart | Dual-target templates |
| Demo scripts | `meet_demo.py`; OpenRMF `dispatch-task.sh` | |
| Optional fleet coordinator | Repo A | Informs Story 3 fleet panel |

### Relationship to existing stories

```
Story 1 (images) ✅
    │
    ├── Story 5 S5-1/S5-2 (spike: learn from reference repos)
    │       │
    │       ├── S5-3 (internalize: own Containerfiles, Helm, Zenoh configs)
    │       │       └── no dependency on reference repos after this point
    │       ├── S5-4 (catalog our internalized images)
    │       ├── S5-5 (deploy-to-local wizard)  ◀── feeds into Story 4 / APPENG-5778 (Kind)
    │       └── S5-6 (deploy-to-OpenShift)     ◀── feeds into Story 4 / APPENG-5777 (K8s manifests)
    │
    ├── Story 2 / Story 6 (single robot sim)
    │       └── APPENG-5771 / 5772 already done via Story 6 (Podman); Repo B
    │           patterns still inform multi-robot / K8s when Story 5 resumes
    │
    ├── Story 3 (multi-robot)
    │       └── Repo B Zenoh + Repo A OpenRMF fleet patterns → APPENG-5775 / 5776
    │
    └── Story 4 (OpenShift bridge)
            └── Our Helm charts (S5-3) deploy to OpenShift
```

### Local deployment options to investigate

| Option | Pros | Cons | Notes |
|--------|------|------|-------|
| **Kind (lean / single sim)** | Proves K8s packaging; aligns with APPENG-5778; same image as Story 6 | Control-plane + nested VM overhead on Mac | **Preferred Kind revisit** — one Deployment of `ros2-jazzy-sim`, port-forward 6080, spawn via `kubectl exec`. See Story 5 revisit note (2026-08-10). |
| **Kind (Repo B multi-pod)** | Closer to OpenShift fleet chart | OOM on arm64 Mac (~4 Gi) | Parked — do not resume until lean path works and/or larger host |
| **Minikube** | Ingress UX; mature | Heavier on Mac | Fallback if Kind networking bites |
| **Plain Podman** | Repo A already has scripts; Story 6 path; fast smoke | Does not prove Helm path | Default for ROSCon / Story 3 |
| **Podman `kube play`** | K8s YAML without full cluster | Weak Helm/Services story | Optional middle ground |

### Open questions / spike risks

1. **Apple Silicon + `linux/amd64`** — Can Repo B (and later our image) run acceptably under emulation, or must we rebuild multi-arch / use a Linux amd64 host for demos?
2. **DDS on Kind/Minikube** — Keep Zenoh anyway for parity with OpenShift, or does localhost-only multi-container Podman skip bridges for smoke tests?
3. **GPU on Mac** — Assume software GL only; is that demo-viable for Gazebo + noVNC?
4. **noVNC on local K8s** — Standardize on port-forward for MVP wizard; Ingress/NodePort as stretch.
5. **Image size / build time** — Fedora+Jazzy+Gazebo+noVNC and Jazzy+RMF images are large; budget Mac disk/RAM and CI time.
6. **Docker Desktop / Podman Machine resources** — Repo B multi-pod requests do not fit a typical Mac Kind node. For lean Kind, size the VM for control plane + ~2.5–3 Gi sim pod (often ≥8 Gi machine memory).
7. **`oc` vs `kubectl`** — Extension and scripts must abstract or prefer kubectl locally.
8. **COPR / Fedora path** — Keep for spike only, or replace when internalizing (ties to parked Ubuntu→Fedora/RHEL work)?
9. **Distro convergence** — Stay on Jazzy for cluster demos while Story 1 Humble sim remains laptop Image Builder default?
10. **Lean Kind vs multi-pod** — Confirm single-sim Kind works on Mac before investing in multi-Nav2 Helm again.

---

## Wishlist / Good to Have

Items that improve polish or operability but are **not** required for the ROSCon MVP. Promote to a tracked sub-task when someone picks them up.

| Status | Area | Item | Notes |
|--------|------|------|-------|
| 💡 | Build / push UI | **Download full build log** | Build/push progress in the UI keeps only the newest ~500 log lines (memory safety). A true “Download full log” needs uncapped logs written to a temp file during the build, plus a download action and cleanup on cancel/complete/reload. Do **not** expose a Settings toggle for “full vs capped” display — prefer download of the full file when this is implemented. |
| 💡 | Build / push UI | Persist progress across extension reload | Progress Maps are in-memory today; reloading the extension clears build/push/pull state. Nice-to-have later if long builds + reload becomes a common pain. |
| 💡 | Simulation | **Upstream Ogre2 Sensors issue** | 2026-08 re-verification: no segfault on current Gazebo/Mesa (`scripts/test-sensors-gpu.sh`). Sensors re-enabled. If regressions appear, file upstream gz-sim issue with repro. |
| 💡 | Simulation / Image Builder | **Humble + noVNC Mac parity (+ optional Quick Start)** | Time-permitting. See notes below. |

> **Legend:** 💡 Wishlist · promote to 🅿️ follow-up or a Jira sub-task when scheduled

##### Wishlist notes — Humble + noVNC / Mac parity (2026-08-10)

**Context:** Quick Start and the Simulation page browser demo (`Open in Browser`, interactive spawn) target **Jazzy** (`ros2-jazzy-sim:noble` + noVNC). Humble already **runs on Mac** for ROS itself via the multi-arch `sloretz` base preset, but `ros2-humble-turtlebot3` has no noVNC stack and a bare entrypoint — so it does not match Story 6 UX. Do **not** add a peer Humble Quick Start until that parity exists (or label it clearly as non-browser).

**Feasible in principle:** The display stack is distro-agnostic Ubuntu packages (`xvfb`, `x11vnc`, `novnc`, `websockify`, `openbox`) plus the same entrypoint pattern as `ros2-jazzy-sim` (Xvfb → VNC → websockify → Gazebo GUI). GPU vs `llvmpipe` follows the same `PHYSICAL_AI_USE_GPU` / Preferences pattern as Jazzy.

**What actually made Mac work for Jazzy** was not noVNC alone — it was **Tier 1 arm64 binaries** on Ubuntu Noble for ROS 2 Jazzy + Gazebo Harmonic + Nav2. Story 6 originally moved off Humble partly because Humble `ros-gz` / Nav2 packaging on arm64 looked like an amd64/QEMU path.

**Spike before scheduling (exit criteria):**

1. On Apple Silicon Podman: install/run Humble + `ros-gz` (or equivalent) + Gazebo GUI (virtio-gpu or llvmpipe); note Fortress vs Harmonic pairing.
2. Port (or share) noVNC entrypoints/worlds/spawn scripts; reuse Sensors + GPU patterns from Jazzy sim.
3. Simulation page + `#detectRosDistro` work against a Humble noVNC image tag.
4. Only then: optional Image Builder Quick Start button (`humble` + `sloretz`), clearly secondary to Jazzy.

**Cost / priority:** Second full sim image to maintain (Containerfile, entrypoints, worlds, Mac GL quirks) for an older LTS while demos stay on Jazzy. Pick up only if there is a real need for Humble + browser Simulation on Mac; otherwise keep Humble as dropdown-only.

<a id="story-6"></a>

### Story 6: Podman-only simulation workflow (ROSCon demo) — 🟡 In Progress (5/6 done)

> **Detail doc:** [stories/story6-podman-sim.md](stories/story6-podman-sim.md)
>
> **Demo path complete** (S6-1–S6-5). **S6-6 Customize Hardware deferred** (stretch — not this pass).

**Goal:** Enable interactive robot simulation using Podman only — no Kubernetes. Replaces Story 5's Kind approach (parked due to arm64 OOM issues). Two paths: (A) Image Builder Quick Start (configure + save + scroll to Build; user builds Phase 1 then Phase 2), (B) interactive layered flow (launch empty Gazebo world → add TurtleBot3 via `podman exec`).

**Relationship to Story 2 (APPENG-5765):** Story 6 implements the core of Story 2 (single robot sim workflow) — specifically APPENG-5771 (container orchestration) and APPENG-5772 (noVNC integration) — using a Podman-only approach instead of pods/compose.

| Status | ID | Summary |
|--------|------|---------|
| ✅ | S6-1 | Jazzy arm64 simulation Containerfile + entrypoints |
| ✅ | S6-2 | Image Builder quick-start preset button |
| ✅ | S6-3 | Backend container lifecycle API (create/start/stop/exec) |
| ✅ | S6-4 | Simulation page: launch, status, open, stop |
| ✅ | S6-5 | Add TurtleBot3 (podman exec spawn) |
| ⚪ | S6-6 | Customize Hardware card *(stretch)* |

**Key finding (S6-1, updated 2026-08):** Ogre2 Sensors plugin temporarily removed during S6-1 (reported arm64 llvmpipe segfault). Re-verified on current Gazebo/Mesa — no crash; plugin re-enabled. arm64 launch passes `/dev/dri` by default (virtio-gpu).

---

<a id="fix-arch-aware-sim"></a>

### FIX: Make simulation image build arch-aware — ✅ Done

**Priority:** Blocking — must be resolved before Story 2 (topic monitor), Story 3 (multi-robot), or S6-6 (customize hardware).

#### Problem

The Jazzy simulation profile is hardcoded to arm64 naming and assumptions throughout the codebase:

1. **Profile name:** `SimulationProfiles.ts` maps `jazzy + turtlebot3` to asset dir `ros2-jazzy-sim-arm64` and image name `ros2-jazzy-sim-arm64`. On an amd64 Linux machine, this produces an image named `ros2-jazzy-sim-arm64:noble` — which is misleading since it would actually contain amd64 packages.

2. **Profile label:** Says "arm64-native" — wrong on amd64.

3. **Containerfile is actually arch-agnostic:** `ros2-jazzy-sim-arm64/Containerfile` uses `FROM $LOCAL_BASE_IMAGE` and `apt install ros-jazzy-*` — apt resolves packages for the host architecture. The image builds and runs on amd64. The only arm64-specific part is the name.

4. **Ogre2 Sensors (2026-08):** Segfault from S6-1 not reproduced on current stack; plugin re-enabled. Lidar/IMU topics publish after spawn on Mac.

5. **Quick Start label:** Says "TurtleBot3 Sim (Jazzy arm64)" — confusing on amd64 Linux.

6. **Base image preset:** `jazzy-arm64` preset says "arm64-native" in its label. The `jazzy` preset (amd64) exists but has no corresponding simulation profile — you can build a Jazzy base on amd64 but not a Jazzy sim.

#### Impact

The extension technically works on amd64 Linux (the Containerfile is arch-agnostic), but the UX is confusing: everything says "arm64" when it isn't. More importantly, there's no proper amd64-specific sim path that could include Ogre2 Sensors (camera/depth data).

#### Proposed fix

| Step | Change | Files |
|------|--------|-------|
| 1 | Rename asset dir from `ros2-jazzy-sim-arm64/` to `ros2-jazzy-sim/` | `packages/backend/assets/` |
| 2 | Rename image from `ros2-jazzy-sim-arm64` to `ros2-jazzy-sim` in `SimulationProfiles.ts` | `packages/shared/src/types/SimulationProfiles.ts` |
| 3 | Update profile label to remove "arm64-native" — e.g. "ROS2 Jazzy + TurtleBot3 + Gazebo + noVNC" | `SimulationProfiles.ts` |
| 4 | Update Quick Start button label — e.g. "TurtleBot3 Sim (Jazzy)" | `SimulationSetup.svelte` |
| 5 | Make world SDF arch-aware: provide two variants or conditionally include Sensors plugin based on host arch (`getHostArch()` already exists in the API) | `assets/ros2-jazzy-sim/worlds/`, `api-impl.ts` or Containerfile |
| 6 | Update `jazzy-arm64` base image preset label to be less arm64-specific, or keep both `jazzy` and `jazzy-arm64` presets with clear labels | `SimulationBaseImages.ts` |
| 7 | Update golden image names in README, plan doc, and story docs | READMEs, plan doc, design.adoc, story docs |

**Step 5 (world SDF) — updated 2026-08:** Sensors plugin **re-enabled** for all arches after re-verification (`scripts/test-sensors-gpu.sh`). Historical options A/B/C below; current world includes `gz-sim-sensors-system`. GPU: arm64 launch passes `/dev/dri` (preference **Simulation GPU passthrough**).

#### Validation

- On Mac arm64: extension builds and runs the sim image as before (renamed from `ros2-jazzy-sim-arm64` to `ros2-jazzy-sim`)
- Quick Start label no longer says "arm64"
- Image name in Quay / local listing is `ros2-jazzy-sim:noble` (not `ros2-jazzy-sim-arm64:noble`)
- Existing pushed images on Quay still work (users who already pulled `ros2-jazzy-sim-arm64:noble` are unaffected — it's a new image name, not a retag)

---

<a id="security-hardening"></a>

### Security Hardening — ✅ Done (2026-08-05)

Comprehensive security audit and hardening of the extension's backend API, entrypoint scripts, and RPC layer. Covered shell injection prevention, container identity verification, command/env/image allowlisting, and defense-in-depth. Tracked in `.internal/security-fixes.md` (H1–L2 batch) and `.internal/follow-up-fixes.md` (S-MED1–R12 follow-ups).

#### Key changes

| Area | What changed |
|------|-------------|
| **Shell injection (H1)** | `#execRosBash` passes dynamic values as bash positional args (`$1`, `$2`); shared validators in `simInput.ts` (`assertRobotName`, `assertRosTopicName`, etc.) |
| **Exec lockdown (H2)** | `#resolveSimulationContainer` requires `io.physical-ai.role=simulation` label + ≥12-char id; `assertSpawnExecCommand` allowlists only `/entrypoint-spawn-robot.sh` |
| **Script hardening (S1)** | `validate-input.sh` mirrors TS regexes in bash; entrypoints validate before sourcing ROS |
| **Launch lockdown (M1)** | `assertLaunchCmd` forces `/entrypoint-gazebo.sh`; `assertLaunchEnv` allowlists env keys; label/port/name validation |
| **Image trust (M2)** | `assertLaunchImageTag` with `ros2-*-sim*` / `ros2-*-turtlebot3` patterns; optional `simulationImageAllowlist` pref for digest pins |
| **Browser port (L2)** | `assertBrowserPort` allowlists only 6080 (noVNC) and 8080 (landing) |
| **RPC arity (S-INFO1)** | `registerInstance` rejects calls with more args than method signature |
| **Stale poll (R1)** | Topic monitor captures target id before async; discards stale results |
| **Dead code (R5)** | Removed `startNav2` from API/impl/tests |
| **New test coverage (R8)** | `SimulationPage.spec.ts`, `SimulationSetup.spec.ts`, `BuildPushPanel.spec.ts` |

**Deferred:** L1 (host asset substitution — local/supply-chain, not UI injection); I1 (ROBOTS env — validated by `assertRobotsEnv`).

---

## Notes on this version

- **Summaries** match Jira exactly (sentence case); section labels add *(stretch)* only as plan metadata, not as part of the Summary field.
- **Parent** is always the parent issue **Key** (not the parent summary text from the Jira export UI).
- **Created** is date-only for readability; Jira timestamps are 2026/07/16 11:53–11:54 PM.
- Epic Description is cleaned slightly from Jira (typo fix: “containers”; numbered drivers) while preserving meaning.
- **Story 5 (2026-07-27):** Updated from independent review of both reference repos — Repo A stack corrected to Jazzy; Mac/Kind risks (amd64, Routes, `oc`, COPR, resources); spike exit criteria; internalization artifact checklist.
- **Story 6 (2026-07-28):** Added Podman-only simulation workflow. Story 5 Kind approach parked (Nav2 OOMKill at 4Gi on arm64). Story 6 replaces it for the ROSCon demo using `podman run` + `podman exec` instead of Kubernetes. Cross-referenced with Story 2.
- **Story 6 (2026-07-28):** S6-1 through S6-5 implemented. Containerfile + entrypoints, Image Builder quick-start, backend lifecycle API (6 methods), Simulation page UI, and TurtleBot3 spawn button all working. Key finding: Ogre2 Sensors plugin crashes on arm64 llvmpipe — removed from world SDF (visuals/physics unaffected). S6-6 (Customize Hardware) remains as stretch.
- **Story 6 polish (2026-07-28):** Curated allowlist includes `ros2-*-sim*`; golden tags add `:noble` base + `ros2-jazzy-sim:noble`; Simulation empty-state + Help describe build→launch→spawn; Quick Start saves and scrolls to Phase 1.
- **Docs / prefs sync (2026-07-30):** Removed stale “Jazzy base-only” claims; Story 5 status unified to Parked; Quick Start docs match save+scroll (no auto-build); prefs enum includes `jazzy-noble`; Help/design cover push cancel, public Quay limits, and local image listing.
- **Arch-aware sim fix (2026-07-31):** Implemented FIX — renamed `ros2-jazzy-sim-arm64` → `ros2-jazzy-sim`, `jazzy-arm64` preset → `jazzy-noble` with legacy mapping, fixed SimulationPage regex and CatalogCurated default pattern, updated all labels/docs to be arch-neutral. Option C for Ogre2 Sensors (always exclude, test on amd64 later).
- **APPENG-5922 done (2026-08-04):** Topic Monitor drill-down — expandable rows with publisher/subscriber node names via `ros2 topic info -v`. On-demand fetch, follows ImageCatalog expand/collapse pattern. Added `TopicNodeInfo`/`TopicDetailInfo` types, `getRosTopicDetail` backend method, frontend drill-down UI + tests. APPENG-5923 (message peek) is now unblocked.
- **Security hardening (2026-08-05):** Full security audit and remediation. Shell injection (H1), exec/launch lockdown (H2/M1), script hardening (S1), image trust (M2), browser port allowlist (L2), RPC arity validation, stale poll fix, dead code removal, new UI test coverage. Tracked in `.internal/security-fixes.md` and `.internal/follow-up-fixes.md`. All items done except L1 (deferred, local-only risk) and I1 (deferred, already validated).
- **APPENG-5923 done (2026-08-06):** Topic Monitor message peek — **Peek** on expanded rows runs `ros2 topic echo --once` (Preferences timeout 1–30s, default 5, best-effort QoS); cleaned body, capture/msg timestamps, Tree/Raw + Copy, schema via `ros2 interface show`, soft topology + type badges.
- **Wishlist (2026-08-10):** Humble + noVNC Mac parity (optional Quick Start) — time-permitting. noVNC stack is portable; hard part is Humble `ros-gz`/Gazebo arm64 + porting Story 6 entrypoints. Cross-linked from Story 1 Future. Do not add peer Humble Quick Start until Simulation browser UX works.
- **In Review + Story 6 polish (2026-08-10):** APPENG-5920 / 5922 / 5923 marked **In Review** in plan and story docs. Ready Now points at 5774 / OpenShift spike / deferred S6-6. Story 6 demo path framed complete; ROSCon e2e checklist added in story6 doc. S6-6 still stretch/out of scope.
- **Kind lean path (2026-08-10):** Documented revisit of Kind using a **single** `ros2-jazzy-sim` Deployment (Story 6 parity) instead of Repo B multi-pod Nav2 charts that OOM’d on arm64. Updated Story 5 status, local deployment options, APPENG-5778 note, and Ready Now.
- **Story 3 = Podman Compose (2026-08-10):** Clarified APPENG-5774/Story 3 deliverable is **Podman Compose** multi-container fleet (not scale-in-one-container alone). Story 6 multi-spawn remains a lightweight demo path.
- **GPU + Sensors (2026-08-11):** arm64 simulation launch passes `/dev/dri` by default (**Simulation GPU passthrough** preference). Ogre2 Sensors re-enabled after re-verification (`scripts/test-sensors-gpu.sh`); `/scan` and `/imu` publish after spawn. Nav2 stack launch still deferred; **Go** remains `cmd_vel`.
- **New Story 2 follow-ups (2026-08-11):** Added APPENG-5980 (local Nav2 feasibility spike on Mac) and APPENG-5981 (wire Go to Nav2). Initial 5980 run found namespaced param wiring and split TF publishing blockers; **5980 update (2026-08-12):** fixed and validated go (`navigate_to_pose` active on Mac). **5981** scopes UI/backend wiring from cmd_vel to Nav2.
