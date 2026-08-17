# Story 4 — OpenShift Bridge: End-to-End Verification Checklist

**Jira:** APPENG-5777 | **Branch:** `feature/APPENG-5777-openshift-deploy`

Extension-based verification steps for the follow-up items in
[`story4-followups.md`](story4-followups.md). Steps accumulate here as items land
so they can all be run together in one pass once everything is implemented.

**Definitive test = via the extension**, on OpenShift project `sgahlot-pd-extn`
(assume already logged in). Rebuild + reload the extension first:

```bash
npm run build      # from packages/ root
# then in Podman Desktop: Settings → Extensions → reload the local extension
```

---

## Item 1 — Robot teardown reaps ROS processes

Per-robot **Remove** must kill the robot's ROS processes and drop its Gazebo
model, leaving no orphans behind.

### Cluster path (Deploy to OpenShift)

1. **Deploy to OpenShift** → deploy the `ros2-jazzy-sim` image; wait until ready.
2. Spawn `robot_1`, then **Navigate** once so its full Nav2 stack comes up.
3. Count the robot's processes in the pod (should be non-zero):
   ```bash
   oc exec <pod> -n sgahlot-pd-extn -- \
     bash -lc 'pgrep -af "namespace:=robot_1|__ns:=/robot_1" | wc -l'
   ```
4. Click **Remove** on `robot_1`. The card disappears; the model vanishes from noVNC.
5. Re-run the `pgrep` from step 3 → expect **0**.
6. Spawn `robot_1` again and **Navigate** → works cleanly (no duplicate/orphan stack).
7. **Prefix safety:** spawn `robot_1` and `robot_10`, **Remove** `robot_1`, confirm
   `robot_10` is still present and drivable (the boundary anchor must not reap it).

### Local path (Simulation page)

1. Launch a Jazzy sim locally, open noVNC.
2. **Add TurtleBot3** `robot_1`, **Navigate** once.
3. `podman exec <container> bash -lc 'pgrep -af "namespace:=robot_1|__ns:=/robot_1" | wc -l'` → non-zero.
4. Click **Remove** → model disappears from noVNC.
5. Re-run the `pgrep` → expect **0**.

---

## Item 2 — Pre-warm Nav2 at spawn (first-navigate cold-start)

Spawning a robot should start warming Nav2 in the background so the **first**
Navigate click is (near-)instant instead of paying the ~40–90 s software-render
cold-start.

### Cluster path (Deploy to OpenShift)

1. Deploy `ros2-jazzy-sim`; wait until ready.
2. Spawn `robot_1`. **Do not click Navigate yet** — start a stopwatch.
3. Watch the pod: the Nav2 bringup should start on its own within a few seconds
   of the spawn (no Navigate click):
   ```bash
   oc exec <pod> -n sgahlot-pd-extn -- \
     bash -lc 'pgrep -af "bringup_launch.py.*namespace:=robot_1" | wc -l'   # → non-zero
   ```
4. Give it ~60–90 s (open noVNC, pick a target meanwhile). Confirm TF is up:
   ```bash
   oc exec <pod> -n sgahlot-pd-extn -- bash -lc \
     'export HOME=/tmp/ros-home; source /opt/ros/jazzy/setup.bash; \
      timeout 5 ros2 run tf2_ros tf2_echo map base_link \
      -r /tf:=/robot_1/tf -r /tf_static:=/robot_1/tf_static 2>&1 | grep -m1 Translation'
   ```
5. **Now** click **Navigate** → it should reach the goal without the long initial
   stall (Nav2 was already warm). Compare wall-clock to the pre-fix behaviour
   (first click used to hang ~40–90 s before moving).
6. **No double-launch:** confirm only **one** `bringup_launch.py` for `robot_1`
   (re-run step 3's `pgrep` after clicking Navigate — still one stack, the click
   reused the pre-warmed one).

### Local path (Simulation page)

1. Launch a Jazzy sim, open noVNC, **Add TurtleBot3** `robot_1`.
2. Without clicking Navigate:
   `podman exec <container> bash -lc 'pgrep -af "bringup_launch.py.*namespace:=robot_1" | wc -l'` → non-zero within a few seconds.
3. Wait ~60 s, then **Navigate** → near-instant start.

### Notes
- **Humble** deployments must **not** pre-warm (Humble uses open-loop `cmd_vel`,
  no Nav2). If testing a Humble image, step 3's `pgrep` should stay **0**.
- Pre-warm never surfaces errors — if it fails, the first Navigate just pays the
  cold-start as before (no regression).

## Item 3 — Unified tabbed Simulation page (Deploy-page UI/UX)

The old "Simulation" and "Deploy to OpenShift" pages are now one **Simulation**
page with **Local** and **OpenShift** tabs, plus three OpenShift-tab fixes.

### Navigation / structure

1. Dashboard shows a **single "Simulation" card** (no separate "Deploy to
   OpenShift" card). Click it → lands on the **Local** tab.
2. Top of the page shows **Local | OpenShift** tabs; the active tab is
   underlined. Click **OpenShift** → deploy form + deployed-sims list appear.
   Click **Local** → launch/robot UI appears. The URL tracks the tab
   (`…#/simulation` vs `…#/simulation/openshift`).
3. **Back-compat:** manually visit `…#/deploy` → it redirects to the OpenShift
   tab (`…#/simulation/openshift`).

### OpenShift-tab fixes

4. **Manifest preview collapses.** On the OpenShift tab, click **Preview
   manifests** → YAML shows with a **Hide** button. Click **Hide** → YAML
   collapses (button reads **Show**); click **Show** → it returns.
5. **Result panel clears on delete.** Deploy a sim → the green "Deployed…/Open
   <url>" panel appears. **Delete** that deployment → the panel disappears (it
   used to linger).
6. **Robot list cleared on delete.** Deploy, spawn `robot_1`/`robot_2`, then
   **Delete** the deployment. Re-deploy the same name → its robot list starts
   **empty** (no stale robots carried over).

## Item 4 — Spawn name auto-increment (no duplicate cards)

Applies to **both** tabs (shared `RobotControls`).

1. Spawn once with the default **robot_1** → after it lands, the Name field
   auto-advances to **robot_2** (next free name).
2. Spawn again (robot_2) → field advances to **robot_3**. No two cards share a
   name.
3. **Duplicate guard:** manually type an existing name (e.g. `robot_1`) and
   Spawn → it's rejected inline ("A robot named … already exists.") and no API
   call is made / no second card appears.
4. **Skips gaps:** with robots `robot_1` and `robot_3` present, spawning fills
   and then suggests the next free number rather than reusing a taken one.

## Item 5 — Configurable software-render CPUs + image thread caps

Two parts: the **configurable CPU count** (in-extension, live now) and the
**thread caps** (image-level — needs the user's rebuilt image first).

### Configurable CPU count (extension)

1. On the **OpenShift** tab, the deploy form shows a **Software-render CPUs**
   field defaulting to **8**. With the GPU box **unchecked**, **Preview
   manifests** → the Deployment shows `resources.requests.cpu: "8"` and
   `resources.limits.cpu: "8"`.
2. Change the field to **6**, **Preview** again → both now show `"6"`. (Any whole
   number 1–64; out-of-range is rejected by `assertCpuCount`.)
3. Tick the **GPU** box → the CPU field disables (greyed) and Preview shows
   `cpu: "1"`/`"2"` + `nvidia.com/gpu: "1"` regardless of the field (GPU offloads
   the render).
4. Deploy at 8, spawn a robot, **Navigate**: motion at least as smooth as the
   6-CPU build. Optional, in the pod during nav:
   ```bash
   oc exec <pod> -n sgahlot-pd-extn -- cat /sys/fs/cgroup/cpu.stat
   ```
   `nr_throttled` should climb more slowly than on the 6-CPU build.
5. **Scheduling note:** an N-CPU Guaranteed pod only lands on a node with ≥ N
   *allocatable* CPU. If it sits `Pending`, lower the field or check node
   headroom (`oc describe node`). See `story7-multipod-openshift-architecture.md`.

### Thread caps (needs the rebuilt image)

After the user rebuilds + pushes the sim image with the updated
`entrypoint-gazebo.sh`:

6. Deploy (software render), then in the pod:
   ```bash
   oc exec <pod> -n sgahlot-pd-extn -- \
     bash -lc 'echo nproc=$(nproc); echo LP=$LP_NUM_THREADS OMP=$OMP_NUM_THREADS'
   ```
   `nproc` still shows the node count, but `LP`/`OMP` show the **quota** (e.g. 8),
   and the entrypoint logged `capping render/physics thread pools to 8 CPU(s)`.
7. During active nav, `cat /sys/fs/cgroup/cpu.stat` → `nr_throttled` grows far
   slower than before (was ~98% of periods), RTF stays ≈ 1.0, motion smoother.
8. **Local (podman) sanity:** no cgroup quota → the caps are *not* set (the
   entrypoint skips the block), so a beefy laptop isn't throttled. Confirm with
   the same `echo LP=$LP_NUM_THREADS` (empty) unless `PHYSICAL_AI_CPU_CAP` is set.

<!-- Append new items below as they are implemented. -->


