# Story 4: OpenShift Deployment Bridge — 🟡 In Progress

**Jira:** APPENG-5767 | **Parent:** APPENG-5763 (Epic) | **Priority:** Required (post–ROSCon MVP)

**Description:** Export local Podman configuration to Kubernetes manifests. Enable optional Kind-based local cluster testing before pushing to OpenShift. Document the full laptop-to-cluster workflow.

---

## Sub-task Progress

| Status | Key | Summary |
|--------|-----|---------|
| 🟡 | APPENG-5777 | Generate K8s manifests from running Podman pod configuration + deploy to OpenShift |
| ⚪ | APPENG-5778 | Kind cluster integration for local validation |

> **Kind note (2026-08-10):** Prefer a lean single-sim Deployment of `ros2-jazzy-sim` (port-forward noVNC, spawn via `kubectl exec`) before multi-pod Nav2 charts. Multi-pod Kind OOM’d on arm64 Mac — see plan Story 5 revisit note.
| ⚪ | APPENG-5779 | Getting-started guide for the full workflow |

---

## APPENG-5777: K8s Manifest Generation + Deploy — 🟡 In Progress

**Description:** Export the running Podman pod configuration as Kubernetes-compatible manifests, enabling the transition from local development to cluster deployment.

**Milestone 1 — deploy a single simulation container (done, branch `feature/APPENG-5777-openshift-deploy`):**

Build the "Deploy to OpenShift" capability **into the extension** (not run from the CLI). Deploy a single Gazebo + noVNC simulation image to the current cluster and reach it via a Route.

- **Manifest builders** (`packages/shared/src/openshift/manifests.ts`) — dependency-free, unit-tested builders that emit the `Deployment` / `Service` / `Route` objects for one simulation pod:
  - Deployment: `ENTRYPOINT /bin/bash` with `/entrypoint-gazebo.sh` arg, CPU/software rendering only (`LIBGL_ALWAYS_SOFTWARE=1`, `GALLIUM_DRIVER=llvmpipe` — **no GPU in-cluster**), noVNC on container port 6080, TCP readiness probe.
  - Service on 6080; **edge-TLS Route** targeting the `novnc` port.
  - All resources labeled `app.kubernetes.io/part-of=physical-ai` for list/delete.
  - A minimal YAML emitter renders the objects for an on-screen **preview only**.
- **Native apply** — deploy uses `extensionApi.kubernetes.createResources` on the JS objects (no `oc apply` / shell for the deploy path).
- **Backend methods** (`api-impl.ts`): `getOpenShiftContext` (reads current context from the kubeconfig), `generateOpenShiftManifests` (preview), `deployToOpenShift` (apply + best-effort Route URL via `oc get route -o jsonpath`), `listOpenShiftDeployments` / `deleteOpenShiftDeployment` (filtered by the `part-of` label).
- **Frontend** (`DeployOpenShift.svelte`, reachable from the Dashboard / `/deploy`): shows the cluster context, a name/namespace/image form defaulted to the current sim config's amd64 tag, a manifest preview, a Deploy action, and a list of managed workloads with ready-count, Route links, and delete.
- **amd64 build (Phase A)** — the cluster is amd64 while the Mac host is arm64, so the Image Builder gained a **Target Architecture** selector (amd64 / arm64) with a cross-arch build warning, so a cluster-pullable amd64 image can be built from Podman Desktop.

**Deferred (fast-follow, not in Milestone 1):** login handling, GPU in-cluster, in-cluster robot spawn + Nav2, and fleet / multi-robot (Story 3). Local Kind validation is APPENG-5778.

---

## APPENG-5778: Kind Cluster Integration — ⚪ Not Started

**Description:** Enable deploying the generated K8s manifests to a local Kind cluster from the extension for validation before pushing to OpenShift.

*No work done yet.*

---

## APPENG-5779: Getting-Started Guide — ⚪ Not Started

**Description:** Write end-to-end documentation covering the full developer journey: installing the extension, launching a robot simulation, scaling to a fleet, and deploying to OpenShift.

*No work done yet.*
