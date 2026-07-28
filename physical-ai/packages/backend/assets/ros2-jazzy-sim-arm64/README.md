# ROS2 Jazzy Simulation Image (arm64-native)

Gazebo Harmonic + Nav2 minimal TurtleBot3 + noVNC on Ubuntu 24.04 / ROS 2 Jazzy. Built for Mac Apple Silicon without QEMU.

## Relationship to base

Phase 2 image. Build with:

```bash
podman build \
  --build-arg LOCAL_BASE_IMAGE=quay.io/ecosystem-appeng/ros2-jazzy-base:noble \
  -t quay.io/ecosystem-appeng/ros2-jazzy-sim-arm64:noble \
  packages/backend/assets/ros2-jazzy-sim-arm64/
```

Or use **Image Builder → Quick Start → TurtleBot3 Sim (Jazzy arm64)** then Phase 1 + Phase 2.

## Runtime

```bash
podman run -d --name pai-sim -p 6080:6080 -p 8080:8080 \
  quay.io/ecosystem-appeng/ros2-jazzy-sim-arm64:noble \
  /entrypoint-gazebo.sh
# Browser: http://localhost:6080 — empty world
podman exec -d pai-sim /entrypoint-spawn-robot.sh robot_1 -2.0 -0.5 0.0
```

## Notes

- Sensors system plugin removed from the sandbox world (Ogre2 + llvmpipe segfault on arm64). Visuals/physics/spawn still work.
- Extension Simulation page filters for `ros2-*-sim-*` / `ros2-*-turtlebot3` tags.
