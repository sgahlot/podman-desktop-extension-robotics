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

<!-- Append new items below as they are implemented. -->
