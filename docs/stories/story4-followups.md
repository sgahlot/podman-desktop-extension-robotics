# Story 4 — OpenShift Bridge: Follow-up Backlog

**Jira:** APPENG-5777 (parent) | **Branch:** `feature/APPENG-5777-openshift-deploy`

Running list of requested changes / issues found during live-cluster testing on `sgahlot-pd-extn`.
Grouped by area. Checkboxes track status; each item notes where the fix lives.

---

## Done (this session)

- [x] **Navigate silently failed in-cluster** — `oc exec` ROS calls ran with `HOME=/` (not writable), so every rclcpp command aborted with `Failed to create log directory '//.ros/log'` (exit 250). Goals never reached Nav2 → "Navigating…" then Failed. **Fix:** `#execRosBash` sets `HOME`/`ROS_HOME`/`ROS_LOG_DIR` to `/tmp/ros-home` on the `oc` path only (`api-impl.ts`). Also unblocks Topic Monitor Peek on OpenShift pods.
- [x] **Slow/jerky navigation at 4 CPUs** — during active nav the GUI (~2.3 cores) + Nav2 (~1) + server (~0.3) exceed 4 cores → RTF sags. **Fix:** software-render Deployment now requests **6 guaranteed CPUs** (`manifests.ts`). RTF measured ~1.0 at 6 cores (was ~0.3–0.6 at 4). **Validated via the extension** on `sgahlot-pd-extn`: warm navigate to (-1.0, -0.2) completed in ~33 s, smooth and fast.

## Perf — open

- [ ] **Residual stutter from CFS throttling.** Container sees `nproc=16` but is capped at 6 cores; Gazebo/Ogre size thread pools to 16 → bursts exceed quota → ~98% of 100ms periods throttled → micro-freezes ("moves every few seconds") even when average RTF ~1.0. Options: (a) bump to 8 CPUs; (b) **cap render/physics threads** to the quota (`OMP_NUM_THREADS`, Ogre/GZ thread envs) — image-level, the proper fix; (c) **GPU** — offloads the render, the real smoothness fix.
- [ ] **First-navigate cold-start (~40–90s).** First Navigate after a fresh spawn pays Nav2 cold-start (costmaps/AMCL converge) while `#ensureNav2Running` polls TF for only 60s — can time out. **Fix:** raise the poll timeout for the software path and/or pre-warm Nav2 at spawn time (`api-impl.ts` `#ensureNav2Running`).

## Robot lifecycle — open

- [ ] **Deleting a robot doesn't reap its ROS processes.** Nav2 stack / `parameter_bridge` / `robot_state_publisher` keep running detached after a robot is removed from the world, so orphans accumulate across spawn/delete cycles and starve CPU. Robot teardown must kill the namespaced processes.
- [ ] **Spawn name field doesn't auto-increment.** Spawning "robot_2" twice yields two "robot_2" cards. Field should suggest the next free name after each spawn.

## Deploy page UI/UX — open

- [ ] **Rename "Deploy to OpenShift" card/page** (wording TBD).
- [ ] **Collapsible "Manifest preview"** — no way to collapse it currently; it dominates the page.
- [ ] **Robot list stale after deployment delete.** After Delete, the extension sometimes still shows the old robot(s), sometimes not (inconsistent). The per-deployment robot list should be cleared when its deployment is deleted.
- [ ] **"Deployed to…" / "Open …" result panel persists after delete.** It should disappear when the deployment is deleted; currently it only clears momentarily when Deploy is clicked again.

---

_Update this file as items are triaged/fixed. Fixes referenced in commit messages by the checkbox text._
