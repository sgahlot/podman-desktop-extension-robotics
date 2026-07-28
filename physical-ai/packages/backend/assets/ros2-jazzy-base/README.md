# ROS2 Jazzy Base Image

Base layer for Jazzy simulation images (including `ros2-jazzy-sim-arm64`). Provides ROS2 Jazzy with common build tools.

## What's included

- ROS2 Jazzy (`ros-base`) from the official `docker.io/library/ros` image
- Build tools: colcon, rosdep, vcstool, cmake, git
- Entrypoint sources `/opt/ros/jazzy/setup.bash`

## Presets (Image Builder)

| Preset id | Image | Arch | Output tag |
|-----------|--------|------|------------|
| `jazzy-arm64` (default for Jazzy) | `docker.io/library/ros:jazzy-ros-base` | amd64, arm64 | `:noble` |
| `jazzy` | digest-pinned `ros:jazzy-ros-base` | amd64 only | `:latest` |

## Build manually

```bash
# Arm64-friendly / Story 6 Quick Start tag
podman build -t quay.io/ecosystem-appeng/ros2-jazzy-base:noble \
  packages/backend/assets/ros2-jazzy-base/

# Classic amd64 tag
podman build -t quay.io/ecosystem-appeng/ros2-jazzy-base:latest \
  packages/backend/assets/ros2-jazzy-base/
```

## Notes

- Simulation: build Phase 2 `ros2-jazzy-sim-arm64` with `LOCAL_BASE_IMAGE` pointing at this base.
- Prefer `jazzy-arm64` / `:noble` on Apple Silicon.
