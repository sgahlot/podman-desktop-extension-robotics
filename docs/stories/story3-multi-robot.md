# Story 3: Multi-Robot Local Scaling — ⚪ Not Started *(stretch)*

**Jira:** APPENG-5766 | **Parent:** APPENG-5763 (Epic) | **Priority:** Stretch

**Description:** Scale from one robot to a local fleet using Podman pods or Compose. Integrate Zenoh middleware for inter-robot communication across containers. Provide a fleet dashboard showing robot status and topic routing. (Stretch goal for MVP)

---

## Sub-task Progress

| Status | Key | Summary |
|--------|-----|---------|
| ⚪ | APPENG-5774 | Podman Compose or pod-based multi-container orchestration for 2+ robots |
| ⚪ | APPENG-5775 | Zenoh router and DDS bridge sidecar auto-configuration |
| ⚪ | APPENG-5776 | Fleet status panel in the extension UI |

---

## APPENG-5774: Multi-Container Orchestration — ⚪ Not Started

**Description:** Enable launching multiple robot containers locally using Podman Compose or pod-based orchestration, scaling from a single robot to a local fleet.

*No work done yet.*

---

## APPENG-5775: Zenoh/DDS Auto-Configuration — ⚪ Not Started

**Description:** Automatically configure Zenoh router and DDS bridge sidecars when scaling to multiple robots, enabling inter-robot communication across containers.

*No work done yet.*

---

## APPENG-5776: Fleet Status Panel — ⚪ Not Started

**Description:** Build a dashboard panel in the extension showing fleet-level status: robot count, individual robot state, and topic routing across the local fleet.

*No work done yet.*
