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
  - Deployment: `ENTRYPOINT /bin/bash` with `/entrypoint-gazebo.sh` arg, CPU/software rendering only (`LIBGL_ALWAYS_SOFTWARE=1`, `GALLIUM_DRIVER=llvmpipe` — **no GPU in-cluster**), **6 guaranteed CPUs** (`requests == limits`, needed for smooth real-time navigation under software rendering — see CPU-sizing note below), noVNC on container port 6080, TCP readiness probe.
  - Service on 6080; **edge-TLS Route** targeting the `novnc` port.
  - All resources labeled `app.kubernetes.io/part-of=physical-ai` for list/delete.
  - A minimal YAML emitter renders the objects for an on-screen **preview only**.
- **Native apply** — deploy uses `extensionApi.kubernetes.createResources` on the JS objects (no `oc apply` / shell for the deploy path).
- **Backend methods** (`api-impl.ts`): `getOpenShiftContext` (reads current context from the kubeconfig), `generateOpenShiftManifests` (preview), `deployToOpenShift` (apply + best-effort Route URL via `oc get route -o jsonpath`), `listOpenShiftDeployments` / `deleteOpenShiftDeployment` (filtered by the `part-of` label).
- **Frontend** (`DeployOpenShift.svelte`, reachable from the Dashboard / `/deploy`): shows the cluster context, a name/namespace/image form defaulted to the current sim config's amd64 tag, a manifest preview, a Deploy action, and a list of managed workloads with ready-count, Route links, and delete.
- **amd64 build (Phase A)** — the cluster is amd64 while the Mac host is arm64, so the Image Builder gained a **Target Architecture** selector (amd64 / arm64), so a cluster-pullable amd64 image can be built from Podman Desktop. A dedicated **Quick Start — OpenShift** panel (`TurtleBot3 Sim (Jazzy · amd64)`) one-clicks the correct settings with `targetArch=amd64`. The multi-arch `jazzy-noble` base is reused (with `--platform linux/amd64` the build selects its amd64 layer; its `noble` tag matches the Deploy default `ros2-jazzy-sim:noble-amd64`). Cross-building amd64 on an arm64 host is surfaced as a neutral informational note (expected, slower via QEMU) rather than a warning.

**Milestone 2 — in-cluster robot spawn + Nav2 (done, same branch):**

Drive a deployed pod the same way as a local simulation, reusing the existing spawn/Nav2 orchestration.

- **`ExecTarget` abstraction** (`api-impl.ts`) — a discriminated union (`{ kind: 'podman', id }` | `{ kind: 'oc', pod, namespace }`) threaded through every spawn / Nav2 / pose helper so only the transport differs. `podman exec` and `oc exec … --` are built by one `#attachedArgv` switch; `#execDetached` keeps `podman exec -d` for local and backgrounds the remote process with `nohup … &` inside `bash -c` for `oc` (which has no detached flag). Remote args are single-quoted for injection safety.
- **Backend methods**: `spawnRobotInOpenShift` (resolves a Running pod via `oc get pods -l app=<name>`, then runs `/entrypoint-spawn-robot.sh` detached) and `sendOpenShiftNavigationGoal` (reads the deployment image to detect the distro, then Nav2 on Jazzy / cmd_vel on Humble — the same code paths as the local `sendNavigationGoal`). Input validation reuses `assertSpawnExecCommand` / `assertRobotName`.
- **Frontend** (`DeployOpenShift.svelte`): each **ready** workload card gains a Robots panel — a name / X / Y / Yaw spawn form and, per spawned robot, target X/Y inputs, a Navigate button, and a live nav status (idle / navigating / reached / failed).
- **Tests**: backend specs cover the `oc exec` argv + `nohup` backgrounding, pod resolution failure, distro routing (Jazzy Nav2 vs Humble cmd_vel), and injection rejection; a new `DeployOpenShift.spec.ts` covers the spawn → navigate UI flow. Existing podman-path tests are unchanged, guarding against regressions from the refactor.

**Milestone 2 — post-integration fixes (2026-08-13, verified against `sgahlot-pd-extn`):**

Live-cluster testing surfaced four issues; each has a code-level fix (all need an **amd64 sim rebuild + redeploy** to take effect — the first three live in the image/manifest):

1. **Sensor render segfault (the big one).** Spawning a robot crashed the pod (`RESTARTS`, exit **139 = SIGSEGV**) because the `gz-sim-sensors-system` plugin tried to create an on-screen **GLX** window under **llvmpipe** (no GPU in-cluster) — `SensorsPrivate::RenderThread → Ogre2RenderEngine::CreateRenderWindow → GL3PlusRenderSystem::_createRenderWindow`. With no liveness probe, the crash restarted the pod and wiped all spawned robots (presented as "robots vanished + noVNC won't reconnect"). **Fix:** off-screen **EGL** for the server — `entrypoint-gazebo.sh` software path sets `EGL_PLATFORM=surfaceless` + `gz sim -s --headless-rendering`; `Containerfile` adds `libgl1-mesa-dri libegl-mesa0 libgbm1`. Keeps `/scan` for Nav2. (Full detail in [Story 6](story6-podman-sim.md#s6-1-jazzy-arm64-containerfile--entrypoints).) The arm64-Mac "sensors OK" verification did **not** cover this because virtio-gpu/Mesa is a different render path than amd64/llvmpipe.
2. **noVNC WebSocket dropped after ~30s.** The edge Route had no timeout, so HAProxy severed the long-lived noVNC socket. **Fix:** `manifests.ts` Route sets `haproxy.router.openshift.io/timeout: 3600s`.
3. **Re-pushed image not picked up.** `imagePullPolicy: IfNotPresent` served a node-cached stale image after a re-push under the same tag (`:noble-amd64`), hiding fixes. **Fix:** `imagePullPolicy: Always`.
4. **"Open" Route link did nothing.** A raw `<a target="_blank">` doesn't open a browser from a Podman Desktop webview. **Fix:** new backend `openUrlInBrowser` → `extensionApi.env.openExternal`; the workload/deploy-result links call it. Also gave bare `.pai-btn` a real secondary-button look (Preview/Refresh/Spawn/Navigate had rendered as plain text).

**Deploy-time GPU toggle (2026-08-14):** The Deploy form gained a **"Cluster has a GPU (NVIDIA GPU operator)"** checkbox (`useGpu` on `OpenShiftDeployConfig`), so the same image serves both a no-GPU and a GPU cluster without a rebuild:

- **Off (default, safe):** container env forces software rendering (`LIBGL_ALWAYS_SOFTWARE=1`, `GALLIUM_DRIVER=llvmpipe`); the entrypoint then uses headless EGL for the sensors (fix #1 above). No GPU requested.
- **On:** env sets `PHYSICAL_AI_USE_GPU=1` (drops the software vars) and the Deployment adds `resources.limits['nvidia.com/gpu']=1`. The entrypoint's render branch sees the GPU request but no `/dev/dri` (the NVIDIA GPU operator exposes `/dev/nvidia*`, not DRI) and renders the server **off-screen via hardware EGL** (`--headless-rendering`, no Mesa `surfaceless`/llvmpipe override).

> ⚠️ The GPU-on path is **structurally implemented but UNVERIFIED** — no GPU-enabled cluster was available to test. The no-GPU (software) path is the tested default. Verify the NVIDIA/EGL branch when a GPU cluster is available.

**In-cluster Navigate hang → root cause was two bugs (2026-08-14):** After the segfault fix, spawning worked but **Navigate hung on "Navigating…"** with the robot not moving. Two independent causes, found via live testing on `sgahlot-pd-extn`:

1. **Silent ROS abort (the real blocker).** The extension's ad-hoc ROS calls run via `oc exec … -- bash -c`, which lands in `HOME=/` (not writable), so every rclcpp command aborted with `Failed to create log directory '//.ros/log'` (exit 250). The TF check and `navigate_to_pose` goal never ran — the goal never reached Nav2 at all, so the robot never moved. **Fix:** `#execRosBash` exports `HOME`/`ROS_HOME`/`ROS_LOG_DIR=/tmp/ros-home` on the `oc` path (`api-impl.ts`). Also unblocks Topic Monitor Peek on OpenShift pods. (Local `podman exec` was unaffected — it has a writable HOME.)
2. **CPU sizing.** Once goals flowed, software rendering was CPU-bound. Sweep: **2 CPUs → RTF ~0.01–0.14 → goal never finishes; 4 CPUs → goals complete but during *active* nav the GUI (~2.3 cores) + Nav2 (~1) + server (~0.3) push utilization to ~90%, so RTF sags to ~0.3–0.6 → slow, jerky ("moves every few seconds"); 6 CPUs → ~60% utilization with headroom → RTF ~1.0, smooth (a warm ~2 m trip completes in ~33 s).** The software-rendering Deployment now requests **6 guaranteed CPUs** (`requests == limits`); the GPU path stays at 2 (render load moves off-CPU). The CPU hog is the `gz sim -g` GUI, **not** the depth camera, so dropping sensors would not lower the floor — a GPU would. Residual micro-stutter remains from CFS throttling (the container sees 16 CPUs but is capped at 6, so Gazebo/Ogre thread bursts get throttled ~98% of periods); GPU or thread-capping is the eventual fix. See `docs/stories/story4-followups.md` for the polish backlog.

**Deferred (fast-follow, not yet done):** login handling, GPU-in-cluster verification (above), and fleet / multi-robot (Story 3). Local Kind validation is APPENG-5778.

---

## APPENG-5778: Kind Cluster Integration — ⚪ Not Started

**Description:** Enable deploying the generated K8s manifests to a local Kind cluster from the extension for validation before pushing to OpenShift.

*No work done yet.*

---

## APPENG-5779: Getting-Started Guide — ⚪ Not Started

**Description:** Write end-to-end documentation covering the full developer journey: installing the extension, launching a robot simulation, scaling to a fleet, and deploying to OpenShift.

*No work done yet.*
