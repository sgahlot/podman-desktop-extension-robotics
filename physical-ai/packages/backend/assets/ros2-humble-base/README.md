# ROS2 Humble Base Image

Base layer for Physical AI simulation images. Adds build tools to a ROS2 Humble desktop upstream.

## What's included

- ROS2 Humble desktop (from upstream `ROS_BASE_IMAGE` preset)
- colcon, rosdep (pre-initialized), vcstool, cmake, build-essential, git

## Base image presets

The Containerfile takes `ROS_BASE_IMAGE` as a build-arg (digest-pinned). The extension
exposes a dropdown with two presets:

| Preset id | Image | Arch | Output tag |
|-----------|--------|------|------------|
| `sloretz` (default) | `ghcr.io/sloretz/ros:humble-desktop@sha256:970146e…` | amd64, arm64 | `:sloretz` |
| `osrf` | `docker.io/osrf/ros:humble-desktop@sha256:3d87cf3…` | amd64 only | `:osrf` |

Digests are stored in `packages/shared/src/types/SimulationBaseImages.ts` and bumped deliberately.

## Relationship to simulation images

Simulation Containerfiles (e.g. `ros2-humble-turtlebot3`) use `FROM <this-image>` and
add robot-specific packages, simulation engines, and workspace builds on top.

## Build (CLI)

```bash
podman build -t quay.io/ecosystem-appeng/ros2-humble-base:sloretz \
  packages/backend/assets/ros2-humble-base/
```

## Run

```bash
podman run --rm -it quay.io/ecosystem-appeng/ros2-humble-base:sloretz
```
