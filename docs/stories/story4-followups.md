# Story 4 — OpenShift Bridge: Follow-up Backlog

**Jira:** APPENG-5777 (parent) | **Branch:** `feature/APPENG-5777-openshift-deploy`

Running list of requested changes / issues found during live-cluster testing on `sgahlot-pd-extn`.
Grouped by area. Checkboxes track status; each item notes where the fix lives.

---

## Done (this session)

- [x] **Navigate silently failed in-cluster** — `oc exec` ROS calls ran with `HOME=/` (not writable), so every rclcpp command aborted with `Failed to create log directory '//.ros/log'` (exit 250). Goals never reached Nav2 → "Navigating…" then Failed. **Fix:** `#execRosBash` sets `HOME`/`ROS_HOME`/`ROS_LOG_DIR` to `/tmp/ros-home` on the `oc` path only (`api-impl.ts`). Also unblocks Topic Monitor Peek on OpenShift pods.
- [x] **Slow/jerky navigation at 4 CPUs** — during active nav the GUI (~2.3 cores) + Nav2 (~1) + server (~0.3) exceed 4 cores → RTF sags. **Fix:** software-render Deployment now requests **6 guaranteed CPUs** (`manifests.ts`). RTF measured ~1.0 at 6 cores (was ~0.3–0.6 at 4). **Validated via the extension** on `sgahlot-pd-extn`: warm navigate to (-1.0, -0.2) completed in ~33 s, smooth and fast.
- [x] **Deploy-page UI/UX → unified tabbed Simulation page** — the standalone "Simulation" and "Deploy to OpenShift" pages are now one **Simulation** page with **Local** and **OpenShift** tabs (`Simulation.svelte` parent; `LocalSimulation.svelte` + `OpenShiftSimulation.svelte` bodies). Dashboard collapses to a single **Simulation** card; the old `/deploy` route redirects to `/simulation/openshift`. Robot spawn/navigate/remove is now one shared `RobotControls.svelte` used by both tabs. OpenShift-tab fixes folded in: (a) a deleted deployment's robot list is cleared (and stale entries pruned on refresh); (b) the "Deployed…/Open…" result panel disappears when its deployment is deleted; (c) the Manifest preview is collapsible (Hide/Show). Renamed page/card per team decision (unified under "Simulation"). Frontend tests updated + `RobotControls.spec.ts` added. **Not yet live-validated on the cluster.**
- [x] **Spawn name field auto-increment** — `RobotControls` suggests the next **free** `robot_N` after each spawn (skips names already in the list) and blocks a duplicate name before calling the API, so spawning no longer yields two identically-named robot cards. Covered in `RobotControls.spec.ts`. **Not yet live-validated on the cluster.**
- [x] **Robot teardown reaps ROS processes** — per-robot **Remove** now tears down the robot instead of leaving orphans. Backend `#teardownRobot(target, robot, distro)` (shared by podman + oc) `pkill -TERM`s then `-KILL`s a boundary-anchored pattern `(namespace:=|robot_name:=|__ns:=/|entrypoint-(spawn-robot|nav2)\.sh )<robot>([ /:]|$)` — catches the spawn launch, `robot_state_publisher`, the Nav2 bringup tree + component nodes, and both entrypoint wrappers; the right boundary keeps `robot_1` from matching `robot_10`, and omitting a bare `/<robot>/` branch keeps the pattern from matching the pkill shell's own argv (the initialpose publisher dies with its Nav2 wrapper via the trap). Then removes the Gazebo model via `gz service …/remove` (world name discovered from the live topic list). Public `despawnRobot` (local) + `despawnRobotInOpenShift` (cluster); per-robot **Remove** button on both the Simulation page and the Deploy page. Tests added for both paths (kill pattern, model remove, injection rejection). **Not yet live-validated on the cluster.**

## Open — working order

Tackled top-down.

### ~~1. Robot teardown reaps ROS processes~~  ✅ done (see above)

### 2. First-navigate cold-start (~40–90s) → pre-warm Nav2 at spawn  *(perf)*
- [x] **Primary fix — pre-warm at spawn:** `#prewarmNav2(target, robot, pose, distro)` waits for the robot to appear in the world (polls `gz model`) then calls `#ensureNav2Running`; called fire-and-forget (try/catch, log-only — never surfaces an error) at the end of **both** spawn paths (`spawnRobotInOpenShift` + local `execInSimulation`) for Jazzy, using the spawn x/y/yaw as the pose. `#ensureNav2Running` already detects an in-progress bringup (`#isNav2BringupRunning`) and just waits for TF, so the later click won't double-launch. Nav2 warms while the user opens noVNC / picks a target → first Navigate fires instantly. Tests cover both paths + the humble skip.
- [x] **Secondary — raise TF poll timeout:** `#ensureNav2Running` now polls `NAV2_TF_POLL_ATTEMPTS` (120 s, was 60) so a slow software cold-start can't abort the goal. Invisible on warm/GPU paths (they return early).
- [x] **Bonus (image-level):** replaced the fixed `sleep 12` before `/initialpose` in `entrypoint-nav2.sh` with a poll for AMCL readiness (waits until AMCL subscribes to `/${ROBOT_NAME}/initialpose`, up to `PHYSICAL_AI_AMCL_READY_ATTEMPTS=60` s, then a 1 s settle; falls back to publishing anyway so behaviour never regresses) so convergence starts several seconds sooner. **Needs an image rebuild + push by the user to take effect on-cluster.**
- [x] **UI: per-robot Nav2 warm-status gates the nav controls** — the backend tracks pre-warm state per robot (`nav2WarmStatus` map: `warming` at spawn → `ready` when the stack is up → `failed` if it gives up → cleared on despawn), exposed via `getRobotWarmStatus` (local) / `getRobotWarmStatusInOpenShift`. Both Simulation tabs poll it every 3 s. While a robot is `warming`, `RobotControls` shows only a "Nav2 warming…" indicator and **hides the target inputs + Navigate + Remove** — the controls appear only once Nav2 is ready (or if pre-warm `failed`, with a subtle "Nav2 warm-up failed" note, since a goal can still cold-start Nav2). No standalone "Nav2 ready" text — the presence of the controls *is* the ready signal. Extension-only — no image rebuild needed. Tests updated (backend query/clear + frontend gating; spawn→navigate tests advance the warm poll to `ready` before clicking Navigate). **Not yet live-validated on the cluster.**

### ~~3. Deploy-page UI/UX~~  ✅ done (see above) — became the unified tabbed **Simulation** page
- [x] Robot list stale after deployment delete → cleared on delete + pruned on refresh.
- [x] "Deployed to…/Open …" result panel persists after delete → cleared when its deployment is deleted.
- [x] Collapsible "Manifest preview" → Hide/Show toggle.
- [x] Rename "Deploy to OpenShift" card/page → unified into the **Simulation** page's **OpenShift** tab.
- [x] **Auto-refresh the deployed-workloads list** — the OpenShift tab now polls `listOpenShiftDeployments` every 3 s (folded into the warm-status timer) via a `silent` refresh (no busy flicker; keeps the last-known list on a transient `oc` error). A just-deployed workload flips to ready and reveals its **Robots** spawn section on its own — no manual **Refresh** click. The manual button still does a normal (busy-indicated) refresh. Test added.

### ~~4. Spawn name field auto-increment~~  ✅ done (see above)
- [x] Next **free** `robot_N` suggested after each spawn; duplicate names blocked.

### 5. Residual stutter from CFS throttling  *(perf — lowest priority; warm nav already smooth)*
- [x] **In-extension: software-render CPUs now configurable, default 8** (`manifests.ts` + `OpenShiftDeployConfig.cpu` + a **Software-render CPUs** field on the OpenShift tab). Container sees `nproc=16` but was capped at 6; Gazebo/Ogre size thread pools to nproc → bursts exceed quota → ~98% of 100ms periods throttled → micro-freezes even at avg RTF ~1.0. 8 cores (default) widen the quota so bursts fit and leave headroom for multi-robot; users can dial it to their node sizes (validated: 1–64, `assertCpuCount`). **Not yet live-validated on the cluster.**
- [x] **Image-level (the proper fix): cap render/physics thread pools to the quota** — `entrypoint-gazebo.sh` now derives the cgroup CPU quota (v2 `cpu.max`, v1 fallback) and caps `OMP_/OPENBLAS_/LP_/MESA_/GALLIUM_NUM_THREADS` to it, so pools stop oversubscribing at *any* core count. Only caps when a quota exists (the unlimited local path is left alone); override with `PHYSICAL_AI_CPU_CAP`. Complementary to the CPU bump. See `docs/stories/story5-image-thread-caps.md`. **Needs an image rebuild + push by the user, then live-validate.**
  - Not env-cappable: Ogre2 render workers and DART physics *island* threads (a world `<physics>` SDF setting). Revisit the world file only if stutter persists after the env caps.
- [x] **Alternative (real smoothness fix): GPU** — offloads the render off the CPU entirely (the `useGpu` path already requests `nvidia.com/gpu` + hardware rendering). Confirmed on `sgahlot-pd-extn`: 6× A10G GPU nodes with the NVIDIA GPU operator running, one GPU free (`ip-10-0-245-11`, ~7 CPU free). **Gap found + fixed:** the GPU nodes are tainted `g5-gpu=true:NoSchedule` but the `useGpu` manifest emitted no toleration, so a GPU pod would sit Pending. Added a configurable **GPU node taint toleration** (`OpenShiftDeployConfig.gpuToleration` as `key[=value][:effect]`, default `g5-gpu=true:NoSchedule`; a bare `key:effect` → `Exists`), parsed by `parseGpuToleration` and emitted as a pod `tolerations` entry only on the GPU path. New optional field on the OpenShift tab (shown when GPU is ticked). Tests added (manifest builder + parser + UI).
  - **First GPU-on-OCP live test (`ip-10-0-245-11`) — two bugs found + fixed:**
    1. **noVNC "Connect" never rendered → Xvfb segfault (image-level).** Xvfb's `+extension GLX` init bound `libnvidia-egl-gbm`/`libEGL_nvidia` and SIGSEGV'd — there is **no `/dev/dri` render node** in an NVIDIA-operator pod (it exposes `/dev/nvidia*` only). Xvfb's death cascaded: openbox/x11vnc couldn't open the display, the GUI aborted (SIGABRT), websockify looped `Connection refused` on 5900 → the browser showed the noVNC **Connect** screen that bounced. **Root cause (deeper than first thought):** the crash is in **glvnd's EGL *vendor* selection**, which `LIBGL_ALWAYS_SOFTWARE`/`GALLIUM_DRIVER` do **not** control (those steer only Mesa's GL/GLX). glvnd picks the EGL vendor by the lowest priority number in `egl_vendor.d` (here `10_nvidia.json` < `50_mesa.json`), so Xvfb got NVIDIA EGL regardless. A first fix that only set `LIBGL_ALWAYS_SOFTWARE=1 GALLIUM_DRIVER=llvmpipe` for Xvfb/GUI **still segfaulted** (confirmed live). **Fix (`entrypoint-gazebo.sh`):** pin the EGL *vendor* explicitly per process via `__EGL_VENDOR_LIBRARY_FILENAMES`, resolving each vendor's ICD **by name** (`_pai_find_egl_vendor nvidia|mesa`) so it's independent of the cluster's glvnd priority numbering (Mesa could be `10_` on another cluster). Xvfb + GUI → Mesa vendor + `__GLX_VENDOR_LIBRARY_NAME=mesa` + software GL (via `XVFB_GUI_GL`, guarded `[@]+` expansion); the **gz server** → NVIDIA vendor (via `GZ_SERVER_GL`) so its headless EGL binds the GPU. **Validated live in the pod:** Xvfb survives on the Mesa vendor (llvmpipe GLX, x11vnc opens the display); the server shows up in `nvidia-smi` (type `G`, ~106 MiB) rendering sensors on the A10G. So on a no-DRI cluster only *sensor* rendering is GPU-accelerated; the **GUI canvas stays CPU-rendered** (hardware GLX for the GUI would need `/dev/dri`, which the operator doesn't expose).
    2. **GPU pod CPU too low for the software GUI (manifest-level).** Because the GUI stays software on no-DRI, the old GPU-path `requests:1/limits:2` throttled it. Bumped to a fixed **`GPU_POD_CPU=6` guaranteed** (requests==limits), which fits the g5.2xlarge node's ~7 allocatable; the user CPU field remains software-render only (GPU-pod CPU is bounded by node size, not preference). Tests updated.
  - **Both fixes need an image rebuild + push by the user** (the entrypoint change is image-level); the manifest CPU change is extension-side. **Re-validate `useGpu` on the free GPU node after the rebuild.**

> **Beyond a single pod:** the CPU/thread work above stabilizes one pod on one
> node. Escaping the single-node scheduling ceiling and scaling to many robots is
> a multi-pod problem — see `docs/stories/story7-multipod-openshift-architecture.md`.

### 6. Redeploy over an active deployment is a silent no-op  *(UX — backlog)*
- [ ] **Problem:** the sim image uses a **mutable tag** (`:noble-amd64`) and Deploy does an `oc apply`. If a deployment of the same name is already running and the emitted spec is unchanged, `apply` sees no diff → **no rollout**, so a freshly-pushed image is **never pulled** (the running pod keeps the old image; `imagePullPolicy: Always` only pulls on pod *creation*). Found live: after pushing a fixed image, the 21-min-old pod stayed on the old (crashing) image until the user deleted the deployment manually.
- [ ] **Options to consider:** (a) if a deployment with the target name already exists, **prompt the user** (redeploy/undeploy-first/cancel); (b) on redeploy, force a rollout so a new image is pulled even when the spec is unchanged (e.g. stamp a `kubectl.kubernetes.io/restartedAt`-style pod-template annotation, or delete+recreate). Note the CPU 1→6 change *did* change the spec, so once the extension is rebuilt a redeploy would roll out on its own — but that's incidental; the general mutable-tag case still needs a forced rollout.

### 7. Port Jazzy sim-image improvements to the Humble image  *(parity — backlog)*
All the sim-image hardening under 5777 targeted **Jazzy only** (`assets/ros2-jazzy-sim/`).
The Humble image (`assets/ros2-humble-turtlebot3/`) has Gazebo + Nav2 packages but a
bare entrypoint (`source … ; exec "$@"`) — no noVNC stack, no headless-render/EGL
logic, no thread caps. Bring it to parity:
- [ ] **Containerfile:** Mesa software GL + off-screen EGL (`libgl1-mesa-dri`,
  `libegl-mesa0`, `libgbm1`) for headless sensor rendering without a GPU; plus the
  noVNC display stack Humble lacks (Xvfb, x11vnc, websockify, openbox).
- [ ] **Entrypoint:** the three-path server render selection (GPU+/dev/dri GLX /
  GPU-no-DRI NVIDIA headless EGL / no-GPU software surfaceless EGL +
  `--headless-rendering`) driven by `PHYSICAL_AI_USE_GPU` and `/dev/dri`.
- [ ] **Thread caps:** the `_pai_cpu_cap()` helper + `OMP_/OPENBLAS_/LP_/MESA_/
  GALLIUM_NUM_THREADS` exports capped to the cgroup quota (`PHYSICAL_AI_CPU_CAP`
  override), no-quota local path left uncapped.
- **Caveats:** Humble is open-loop `cmd_vel` (no Nav2 navigate) and isn't the
  OpenShift software-render target today — decide whether it needs the full noVNC +
  in-cluster path or just the generic robustness (thread caps + headless EGL); the
  port may be partial by design. Humble is Ubuntu 22.04 (Jammy) vs Jazzy 24.04
  (Noble) — verify Mesa/EGL package names on Jammy and that its gz-sim accepts
  `--headless-rendering`. Keep the shell security tests green.
- **Tracking:** a Jira sub-task under APPENG-5767 is drafted (pending the Atlassian
  MCP recovery — see `.internal/pending-jira-actions.md` Action 5), "relates to"
  APPENG-5777 where the Jazzy work landed.

---

_Update this file as items are triaged/fixed. Fixes referenced in commit messages by the checkbox text._
