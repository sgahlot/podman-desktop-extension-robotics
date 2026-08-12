# Story 3: Multi-Robot Local Scaling — ⚪ Not Started

**Jira:** APPENG-5766 | **Parent:** APPENG-5763 (Epic) | **Priority:** Planned (post–ROSCon MVP)

**Description:** Scale from one robot to a local fleet using **Podman Compose**. Integrate Zenoh middleware for inter-robot communication across containers. Provide a fleet dashboard showing robot status and topic routing.

---

## Sub-task Progress

| Status | Key | Summary |
|--------|-----|---------|
| ⚪ | APPENG-5774 | Podman Compose multi-container orchestration for 2+ robots |
| ⚪ | APPENG-5775 | Zenoh router and DDS bridge sidecar auto-configuration |
| ⚪ | APPENG-5776 | Fleet status panel in the extension UI |

---

## Recommended approach (2026-08-10)

**Primary path for this story: Podman Compose** (APPENG-5774) — multi-container local fleet, not “scale only inside one sim container.”

Story 6’s single-container **Add TurtleBot3 × N** remains a useful **lightweight demo** (same Gazebo/noVNC process), but it is **not** the Story 3 deliverable. Story 3 owns Compose-based orchestration so the laptop path aligns with later Kind/OpenShift multi-service layouts.

| Phase | Scope | Notes |
|-------|--------|--------|
| **3a — Podman Compose** (APPENG-5774) | `compose.yaml` (or equivalent) for the fleet: e.g. Gazebo/noVNC service + robot services (and later Zenoh). Extension launches/stops/scales via Compose. Prefer our `ros2-jazzy-sim` / related images where possible. | **Start here** — this is the story |
| **3b — Zenoh** (5775) | Router + DDS bridges so robots in **separate containers** can communicate (and for OpenShift CNI parity) | After Compose topology exists |
| **3c — Fleet panel** (5776) | Dashboard: robot count, state, topic routing across Compose services | After 3a (enrich with Zenoh once 3b lands) |

**Related (not Story 3):** Single-container multi-spawn stays in Simulation / Story 6. Lean Kind = one sim Deployment (plan Story 5 note). Multi-pod Nav2 Kind charts stay parked.

**Out of scope for early Story 3:** multi-robot Nav2 fleet orchestration per robot; local **Go** on Jazzy already uses `navigate_to_pose` (5981). OpenShift Routes remain Story 4.

---

## APPENG-5774: Podman Compose Orchestration — ⚪ Not Started

**Description (Jira):** Enable launching multiple robot containers locally using Podman Compose (or pod-based orchestration), scaling from a single robot to a local fleet.

**Decision:** Use **Podman Compose** as the orchestration mechanism for Story 3. Design services so Zenoh sidecars (5775) can attach later. Single-container spawn is complementary demo UX only — do not count it as completing 5774.

*No work done yet.*

---

## APPENG-5775: Zenoh/DDS Auto-Configuration — ⚪ Not Started

**Description:** Automatically configure Zenoh router and DDS bridge sidecars when scaling to multiple robots, enabling inter-robot communication across containers.

**Note:** Required once robots run in **separate Compose services**. Same-container Story 6 spawns share DDS without Zenoh.

*No work done yet.*

---

## APPENG-5776: Fleet Status Panel — ⚪ Not Started

**Description:** Build a dashboard panel in the extension showing fleet-level status: robot count, individual robot state, and topic routing across the local fleet.

**Note:** Should reflect Compose-managed services/containers (not only the in-sim spawned-robot list).

*No work done yet.*
