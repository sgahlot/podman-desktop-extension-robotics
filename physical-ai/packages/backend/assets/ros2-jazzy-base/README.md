# ROS2 Jazzy Base Image

Base layer for future Jazzy simulation images. Provides ROS2 Jazzy with common build tools.

## What's included

- ROS2 Jazzy (`ros-base`) from the official `docker.io/library/ros` image
- Build tools: colcon, rosdep, vcstool, cmake, git
- Entrypoint sources `/opt/ros/jazzy/setup.bash`

## Preset

- **jazzy** — `docker.io/library/ros:jazzy-ros-base` (amd64 only)

## Build manually

```bash
podman build -t quay.io/ecosystem-appeng/ros2-jazzy-base:latest .
```

## Notes

- Simulation images for Jazzy are not yet available. This base image is provided as a foundation for future simulation support.
- The image is amd64-only. On Apple Silicon it may require emulation.
