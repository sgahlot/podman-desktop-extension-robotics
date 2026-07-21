# Physical AI

Podman Desktop extension for Physical AI robotics development. Provides a GUI-driven path from local development to container deployment for robotics engineers.

## Features

- **Image Catalog** — Browse and pull curated ROS2/Fedora base images from Quay.io. Real-time download progress with per-layer tracking.
- **Build & Push Base Image** — Build the ROS2 Jazzy base image locally from a bundled Containerfile and push it to a container registry.
- **Help** — In-extension documentation covering all features.

## Settings

Configure the extension in **Settings > Preferences > Physical AI**:

- **Default Namespace** (default: `ecosystem-appeng`) — Quay.io namespace used by Image Catalog and Build & Push

## Getting Started

1. Install the extension in Podman Desktop
2. Open **Physical AI** from the left sidebar
3. Browse the **Image Catalog** to pull base images, or use **Build & Push** to build one locally
4. Configure your Quay.io namespace in Settings if you use a different organization

## Coming Soon

- **Simulation** — One-click launch of ROS2 + Gazebo simulations with browser-based visualization
- **Fleet** — Multi-robot local fleet with Zenoh middleware and status dashboard
- **OpenShift Bridge** — Export Podman configurations to Kubernetes manifests and deploy to OpenShift
