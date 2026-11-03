# ROS2 Jazzy Simulation Image

Gazebo Harmonic + Nav2 minimal TurtleBot3 + noVNC on Ubuntu 24.04 / ROS 2 Jazzy. Multi-arch — works on arm64 (Mac) and amd64 (Linux).

## Relationship to base

Phase 2 image. Build with:

```bash
podman build \
  --build-arg LOCAL_BASE_IMAGE=quay.io/ecosystem-appeng/ros2-jazzy-base:noble \
  -t quay.io/ecosystem-appeng/ros2-jazzy-sim:noble \
  packages/backend/assets/ros2-jazzy-sim/
```

Or use **Image Builder → Quick Start → TurtleBot3 Sim (Jazzy)** then Phase 1 + Phase 2.

## Runtime

```bash
podman run -d --name pai-sim -p 6080:6080 -p 8080:8080 \
  quay.io/ecosystem-appeng/ros2-jazzy-sim:noble \
  /entrypoint-gazebo.sh
# Browser: http://localhost:6080 — empty world
podman exec -d pai-sim /entrypoint-spawn-robot.sh robot_1 -2.0 -0.5 0.0
# Or start an installed package launch after checking its package/file:
podman exec pai-sim /entrypoint-launch-robot.sh nav2_minimal_tb3_sim launch/spawn_tb3.launch.py --validate
podman exec -d pai-sim /entrypoint-launch-robot.sh nav2_minimal_tb3_sim launch/spawn_tb3.launch.py robot_name:=robot_2
```

## Podman Machine requirements

The simulation container uses ~2.5–3 GB RAM. Ensure your Podman Machine has at least 4 GB memory (default ~5.7 GB is fine for 1–2 robots). For 3+ robots, increase to 8 GB: `podman machine set --memory 8192`.

## Notes

- Managed entrypoints read `config/robot-definitions.json` (installed at `/opt/ros2-demo/config/robot-definitions.json`) through `lib/robot-definition.py` on every invocation. This is also the shared TypeScript catalog's source; TurtleBot3 is the only built-in entry. Package/launch, URDF, bridge, model, model-resource, and Nav2 defaults live there, not in entrypoint literals. Existing `ROBOTICS_ROS_SETUP`, `ROBOTICS_SIM_DIR`, `ROBOTICS_NAV2_MAP`, and model overrides remain supported. Keep the descriptor and helper with the entrypoints when building or copying the runtime bundle; a fresh exec does not inherit exports from the Gazebo shell. This internal descriptor is separate from custom launch and embedded-SDF profile metadata.
- Entrypoints (`entrypoint-gazebo.sh`, `entrypoint-spawn-robot.sh`, `entrypoint-launch-robot.sh`, …) are required in-image process orchestration. Podman Desktop APIs manage container lifecycle and `podman exec`; they do not replace Gazebo/ROS/noVNC startup or provide a ROS/DDS API. Topic Monitor and similar features still `exec` ROS CLI inside this image.
- Robot spawn verifies the launch-managed Gazebo-to-ROS bridge by waiting for an actual sample on `/<robot_name>/scan`, not another robot's global `/clock`. Both spawn and backend pre-warm reuse `lib/wait-for-scan.py` (installed at `/usr/local/lib/robotics/wait-for-scan.py`). Each wait holds one explicitly typed `LaserScan` subscriber with sensor-data QoS through discovery, using a monotonic deadline and signal cleanup; it does not restart ROS discovery every two seconds. An outer process timeout also bounds imports/startup. Spawn waits up to `ROBOTICS_BRIDGE_READY_TIMEOUT` (default 30 seconds, range 1–60) before testing a direct bridge with a new bounded wait; the launch-managed bridge is retained. Backend pre-warm uses a 70-second scan wait before checking Nav2 TF and cancels on robot removal. Older images without the helper use one bounded, typed CLI subscriber for the backend check. Check `/tmp/ros-home/bridge-<robot>.log` if the direct bridge cannot become ready. Rebuild the sim image to update its spawn-side behavior.
- Entrypoints validate robot names / poses / `ROBOTS` env (and gazebo ports/world) **before** sourcing ROS — hostile args fail closed even if invoked via raw `podman exec`.
- Sensors system plugin enabled in the sandbox world (re-verified 2026-08 — no segfault on **arm64/virtio-gpu**). Lidar/IMU topics available after spawn. **In-cluster (amd64, no GPU):** the same plugin *does* segfault (on-screen GLX under llvmpipe) unless the server renders off-screen via EGL — `entrypoint-gazebo.sh`'s software path sets `EGL_PLATFORM=surfaceless` + `gz sim -s --headless-rendering`, and the Containerfile ships `libgl1-mesa-dri libegl-mesa0 libgbm1`. Do not remove these without re-testing on amd64. See the backend README "GPU and rendering".
- Extension Simulation page filters for `ros2-*-sim*` / `ros2-*-turtlebot3` tags.
- Runtime helper and security stub tests (no container): from `robotics/`, run `npm run test:scripts`.

## Startup/navigation regression checklist

Rebuild the extension and simulation images from the same worktree. Recreate test containers/deployments from those images; existing processes do not acquire updated scripts. Run the following on Local Jazzy, OpenShift amd64/Jazzy, and OpenShift Lyrical, one simulation at a time to avoid shared ROS-domain interference. Record image tag/digest, node, GUI render mode, warm-up duration, goal results, and visible stutter separately; do not infer a navigation fix from faster startup.

- Launch/deploy: viewer works, initial deployment readiness updates without manual Refresh, settled inventory retains its normal cache interval.
- Spawn at `(-2.0, -0.5, 0.0)`: wait for real readiness, confirm Navigate appears, record backend warm-up duration. Return from another tab during warming and confirm the completed duration is not inflated.
- Navigation: first goal `(2.0, 0.5)`, return goal `(-2.0, -0.5)`, then repeated goals such as `(2.0, 1.2)` and `(-0.5, 1.0)`. Record success/failure, duration, recovery behavior, and display jumps. These are observations, not promises that pre-existing navigation/display issues are fixed.
- Removal/re-spawn: remove while warming, confirm no late Nav2 startup or leftover scan-wait process; re-spawn the same name and repeat a navigation. Remove after readiness as well, then stop/delete the workload.
- Compatibility: exercise custom ROS launch and embedded-SDF profiles; they must keep their existing launch/placement behavior and must not acquire a mandatory TB3 scan requirement.
- Negative cases: automated tests cover delayed discovery beyond two seconds, absent scans, fallback failure without killing the managed bridge, and cancellation. Do not deliberately disable live sensors/bridges merely to reproduce these cases during normal manual testing.
