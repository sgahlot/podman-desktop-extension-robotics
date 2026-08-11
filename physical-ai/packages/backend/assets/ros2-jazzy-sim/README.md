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
```

## Podman Machine requirements

The simulation container uses ~2.5–3 GB RAM. Ensure your Podman Machine has at least 4 GB memory (default ~5.7 GB is fine for 1–2 robots). For 3+ robots, increase to 8 GB: `podman machine set --memory 8192`.

## Notes

- Entrypoints (`entrypoint-gazebo.sh`, `entrypoint-spawn-robot.sh`, …) are required in-image process orchestration. Podman Desktop APIs manage container lifecycle and `podman exec`; they do not replace Gazebo/ROS/noVNC startup or provide a ROS/DDS API. Topic Monitor and similar features still `exec` ROS CLI inside this image.
- Entrypoints validate robot names / poses / `ROBOTS` env (and gazebo ports/world) **before** sourcing ROS — hostile args fail closed even if invoked via raw `podman exec`.
- Sensors system plugin enabled in the sandbox world (re-verified 2026-08 — no segfault on current Gazebo/Mesa). Lidar/IMU topics available after spawn.
- Extension Simulation page filters for `ros2-*-sim*` / `ros2-*-turtlebot3` tags.
- Security stub tests (no container): from repo root `npm run test:scripts`.
