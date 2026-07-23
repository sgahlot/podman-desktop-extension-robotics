# Physical AI

Podman Desktop extension for Physical AI robotics development. Provides a GUI-driven path from local development to container deployment for robotics engineers.

## Features

- **Image Catalog** — Browse and pull curated ROS2 base images from Quay.io with real-time download progress
- **Build & Push Base Image** — Build the ROS2 Jazzy base image locally from a bundled Containerfile and push it to a registry
- **Simulation Setup** — Configure robot/distro/middleware/base image and build a TurtleBot3 + Gazebo simulation image
- **Help** — In-extension documentation covering all features

## Getting Started

1. Install / load the extension in Podman Desktop
2. Open **Physical AI** from the UI, or press **F1** and run **Physical AI: Open Dashboard**
3. Browse the **Image Catalog**, use **Build & Push Base Image**, or configure **Simulation Setup**
4. Adjust defaults under **Settings → Preferences → Physical AI** if needed

## Settings

Configure under **Settings → Preferences → Physical AI**:

- **Default Namespace** (default: `ecosystem-appeng`) — Quay.io namespace for catalog and image tags
- Simulation wizard defaults (robot, distro, middleware, engine, base image preset)

## Coming Soon

- **Simulation launch** — One-click ROS2 + Gazebo with browser-based visualization (Story 2)
- **Fleet** — Multi-robot local fleet with Zenoh middleware and status dashboard
- **OpenShift Bridge** — Export Podman configurations to Kubernetes manifests and deploy to OpenShift

## Packaging note

Bundled Containerfile contexts for in-extension builds live under `assets/` in this package.
