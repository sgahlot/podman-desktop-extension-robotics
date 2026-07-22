# ROS2 Humble TurtleBot3 Simulation Image

Simulation image with ROS 2 Humble, TurtleBot3, Gazebo (ros-gz), and Nav2.

## Base image presets

The Containerfile takes `ROS_BASE_IMAGE` as a build-arg (digest-pinned). The extension
exposes a **dropdown** (not free text) with two presets:

| Preset id | Image | Arch | Output tag |
|-----------|--------|------|------------|
| `sloretz` (default) | `ghcr.io/sloretz/ros:humble-desktop@sha256:970146e…` | amd64, arm64 | `:latest` |
| `osrf` | `docker.io/osrf/ros:humble-desktop@sha256:3d87cf3…` | amd64 only | `:osrf` |

> There is no `docker.io/library/ros:humble-desktop` tag. Official desktop images live under **`docker.io/osrf/ros`**.

Digests are stored in `packages/shared/src/types/SimulationBaseImages.ts` and bumped deliberately.

### Why sloretz by default?

Official OSRF Humble desktop is **amd64-only**. The sloretz rebuild is multi-arch and works on Apple Silicon / Podman on Mac.

### CLI override

```bash
podman build \
  --build-arg ROS_BASE_IMAGE='docker.io/osrf/ros:humble-desktop@sha256:3d87cf339919a85cff7743ec9ba5e7ec81ccc26c9f722f1c7a6af5008dfdc128' \
  -t quay.io/ecosystem-appeng/ros2-humble-turtlebot3:osrf \
  containers/ros2-humble-turtlebot3/
```

## Source pins (ROBOTIS-GIT, humble)

| Repo | Commit |
|------|--------|
| turtlebot3 | `90a68bd2e3c61c12966779da89d8eeaec82730e9` |
| turtlebot3_msgs | `cdee60f7618b9ed2f85f65259c0f96e3f02b1c55` |
| DynamixelSDK | `0d3403df29561890eb168652b2ed234dd6728bb2` |
| turtlebot3_simulations | `a35a56c8b04877dc89772b598084d8ce648a9023` |

Update pins deliberately in the Containerfile (and keep `containers/` and `packages/backend/assets/` in sync).

## Layout

- `containers/ros2-humble-turtlebot3/` — CLI / local `podman build`
- `packages/backend/assets/ros2-humble-turtlebot3/` — bundled for the Podman Desktop extension Build UI

## Build (CLI, default sloretz base)

```bash
podman build -t quay.io/ecosystem-appeng/ros2-humble-turtlebot3:latest \
  containers/ros2-humble-turtlebot3/
```

## Run

```bash
podman run --rm -it --ipc=host --net=host \
  quay.io/ecosystem-appeng/ros2-humble-turtlebot3:latest
```
