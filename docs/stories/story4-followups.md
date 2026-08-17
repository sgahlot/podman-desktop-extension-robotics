# Story 4 — OpenShift Bridge: Follow-up Backlog

**Jira:** APPENG-5777 (parent) | **Branch:** `feature/APPENG-5777-openshift-deploy`

Running list of requested changes / issues found during live-cluster testing on `sgahlot-pd-extn`.
Grouped by area. Checkboxes track status; each item notes where the fix lives.

---

## Done (this session)

- [x] **Navigate silently failed in-cluster** — `oc exec` ROS calls ran with `HOME=/` (not writable), so every rclcpp command aborted with `Failed to create log directory '//.ros/log'` (exit 250). Goals never reached Nav2 → "Navigating…" then Failed. **Fix:** `#execRosBash` sets `HOME`/`ROS_HOME`/`ROS_LOG_DIR` to `/tmp/ros-home` on the `oc` path only (`api-impl.ts`). Also unblocks Topic Monitor Peek on OpenShift pods.
- [x] **Slow/jerky navigation at 4 CPUs** — during active nav the GUI (~2.3 cores) + Nav2 (~1) + server (~0.3) exceed 4 cores → RTF sags. **Fix:** software-render Deployment now requests **6 guaranteed CPUs** (`manifests.ts`). RTF measured ~1.0 at 6 cores (was ~0.3–0.6 at 4). **Validated via the extension** on `sgahlot-pd-extn`: warm navigate to (-1.0, -0.2) completed in ~33 s, smooth and fast.
- [x] **Robot teardown reaps ROS processes** — per-robot **Remove** now tears down the robot instead of leaving orphans. Backend `#teardownRobot(target, robot, distro)` (shared by podman + oc) `pkill -TERM`s then `-KILL`s a boundary-anchored pattern `(namespace:=|robot_name:=|__ns:=/|entrypoint-(spawn-robot|nav2)\.sh )<robot>([ /:]|$)` — catches the spawn launch, `robot_state_publisher`, the Nav2 bringup tree + component nodes, and both entrypoint wrappers; the right boundary keeps `robot_1` from matching `robot_10`, and omitting a bare `/<robot>/` branch keeps the pattern from matching the pkill shell's own argv (the initialpose publisher dies with its Nav2 wrapper via the trap). Then removes the Gazebo model via `gz service …/remove` (world name discovered from the live topic list). Public `despawnRobot` (local) + `despawnRobotInOpenShift` (cluster); per-robot **Remove** button on both the Simulation page and the Deploy page. Tests added for both paths (kill pattern, model remove, injection rejection). **Not yet live-validated on the cluster.**

## Open — working order

Tackled top-down.

### ~~1. Robot teardown reaps ROS processes~~  ✅ done (see above)

### 2. First-navigate cold-start (~40–90s) → pre-warm Nav2 at spawn  *(perf)*
- [ ] Nav2 is launched lazily on the first Navigate, so that one click pays the whole cold-start (bringup starts ~12 nodes, entrypoint waits 12s then publishes `/initialpose`, then AMCL/costmaps converge → `map→base_link` TF). Under software rendering that's ~40–90s (the ~3-min case was the dirty pod with orphans). We can't shrink convergence much without a GPU, but we can **hide** it.
  - **Primary fix — pre-warm at spawn:** add `#prewarmNav2(target, robot, pose, distro)` that waits for the robot to appear in the world (poll `gz model`) then calls `#ensureNav2Running`; call it fire-and-forget (try/catch, log-only — never surfaces an error) at the end of **both** spawn paths (`spawnRobotInOpenShift` + local `spawnRobot`) for Jazzy, using the spawn x/y/yaw as the pose. `#ensureNav2Running` already detects an in-progress bringup (`#isNav2BringupRunning`) and just waits for TF, so the later click won't double-launch. Nav2 warms while the user opens noVNC / picks a target → first Navigate fires instantly.
  - **Secondary:** raise the `#ensureNav2Running` TF poll timeout (currently 60s) for the software path so a slow cold-start can't abort the goal.
  - **Bonus:** replace the fixed `sleep 12` before `/initialpose` in `entrypoint-nav2.sh` with a poll for AMCL readiness so convergence starts a few seconds sooner (image-level).
  - **UI (optional):** per-robot "Nav2 warming… → Ready" status so an early click shows honest progress instead of a bare "Navigating…".

### 3. Deploy-page UI/UX  *(frontend)*
- [ ] **Robot list stale after deployment delete.** After Delete, the extension sometimes still shows the old robot(s), sometimes not (inconsistent). The per-deployment robot list should be cleared when its deployment is deleted.
- [ ] **"Deployed to…" / "Open …" result panel persists after delete.** It should disappear when the deployment is deleted; currently it only clears momentarily when Deploy is clicked again.
- [ ] **Collapsible "Manifest preview"** — no way to collapse it currently; it dominates the page.
- [ ] **Rename "Deploy to OpenShift" card/page** (wording TBD).

### 4. Spawn name field auto-increment  *(frontend)*
- [ ] Spawning "robot_2" twice yields two "robot_2" cards. Field should suggest the next free name after each spawn.

### 5. Residual stutter from CFS throttling  *(perf — lowest priority; warm nav already smooth)*
- [ ] Container sees `nproc=16` but is capped at 6 cores; Gazebo/Ogre size thread pools to 16 → bursts exceed quota → ~98% of 100ms periods throttled → micro-freezes even when average RTF ~1.0. Options: (a) bump to 8 CPUs; (b) **cap render/physics threads** to the quota (`OMP_NUM_THREADS`, Ogre/GZ thread envs) — image-level, the proper fix; (c) **GPU** — offloads the render, the real smoothness fix.

---

_Update this file as items are triaged/fixed. Fixes referenced in commit messages by the checkbox text._
