# ROS2 Jazzy Base Image

Development base image for ROS2 Jazzy robotics workloads.

> **Note:** This image currently uses Ubuntu 24.04 as the base (official `ros:jazzy-ros-base`).
> Migration to Fedora is planned once ROS2 Jazzy Fedora packaging matures (COPR or source build).

## What's included

- ROS2 Jazzy core runtime
- **colcon** — ROS2 build tool
- **rosdep** — dependency resolver (pre-initialized)
- **vcstool** — workspace version control
- cmake, build-essential, git

## What's NOT included (future variants)

- **rviz2** and GUI dependencies — planned as a separate "desktop" variant
- **Gazebo** — will be added as a simulation-specific image

## Build

Prefer building from the Podman Desktop extension (**Build & Push Base Image**).
For a local CLI build of the same context:

```bash
podman build -t quay.io/ecosystem-appeng/ros2-jazzy-base:latest packages/backend/assets/ros2-jazzy-base/
```

Base image is digest-pinned in the Containerfile (`ros:jazzy-ros-base@sha256:…`).

## Run

```bash
podman run --rm -it quay.io/ecosystem-appeng/ros2-jazzy-base:latest
```

The entrypoint automatically sources the ROS2 Jazzy environment.

## Verify

```bash
podman run --rm quay.io/ecosystem-appeng/ros2-jazzy-base:latest ros2 --help
podman run --rm quay.io/ecosystem-appeng/ros2-jazzy-base:latest colcon --help
podman run --rm quay.io/ecosystem-appeng/ros2-jazzy-base:latest rosdep --help
```

## Publish

```bash
podman push quay.io/ecosystem-appeng/ros2-jazzy-base:latest
```
