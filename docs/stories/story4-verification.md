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

<!-- Append new items below as they are implemented. -->
