# Physical AI — Podman Desktop Extension

A Podman Desktop extension that gives robotics developers a GUI-driven path from local development to container deployment — no CLI required.

## Features

- **Image Catalog** — Browse and pull ROS2 images from Quay.io (All or Curated view)
- **Image Builder** — Two-phase build (base + simulation) with Quick Start presets. Phase 1 builds the ROS2 base, Phase 2 layers Gazebo + noVNC on top (Nav2 packages included in image; navigation stack deferred to OpenShift).
- **Simulation** — One-click launch of Gazebo in a Podman container, browser-based visualization via noVNC, interactive TurtleBot3 spawning
- **Topic Monitor** — Live view of active ROS2 topics, message types, and publisher/subscriber counts inside running simulation containers
- **Help** — In-extension documentation

Current container bases are **Ubuntu 24.04** (ROS2 Jazzy and Humble). Fedora/RHEL migration is planned.

## Prerequisites

| Requirement | Minimum | Recommended |
|-------------|---------|-------------|
| Podman Desktop | 1.28+ | 1.29+ (tested with 1.28.x, 1.29.x) |
| Podman | 5.x or 6.x | 6.0+ (tested with 5.8.5, 6.0.2) |
| Machine CPUs | 4 | 6+ |
| Machine Memory | 4 GB | 8 GB |
| Machine Disk | 30 GB | 50+ GB |
| Node.js (for building) | 24.0.0 | 24.x (matches Podman Desktop) |

Simulation uses software rendering (`llvmpipe`) by default in the sim image — no GPU required for the demo. On Mac, LibKrun can expose the host GPU via virtio-gpu, but we force software GL for Gazebo stability. Default Podman Machine (~5.7 GB) is fine for 1–2 robots. For 3+ robots, increase to 8 GB: `podman machine set --memory 8192`.

See [`packages/backend/README.md`](packages/backend/README.md) for platform-specific notes (Mac Apple Silicon, Linux).

## Quick Start

```bash
npm install
npm run build
```

1. Load the extension from `packages/backend` in Podman Desktop (Settings → Extensions → Local extension)
2. Open **Physical AI** (or **F1** → **Physical AI: Open Dashboard**)
3. **Image Builder** → Quick Start **TurtleBot3 Sim (Jazzy)** → Phase 1 Build → Phase 2 Build
4. **Simulation** → Launch → Open in Browser → Add TurtleBot3 → optional **Go** (X/Y) and Topic Monitor **Peek**
5. **Stop & remove** when done — close the Gazebo (noVNC) browser tab manually if it is still open

Idle noVNC tabs may show Disconnected; reconnect or refresh — the simulation is still running. Sensors (lidar/camera) are off under software rendering on Mac, so **Go** has no obstacle avoidance.

## Project Structure

| Path | Purpose |
|------|---------|
| `packages/backend` | Extension entrypoint, RPC API, bundled container assets (Containerfiles, entrypoints, world files) |
| `packages/frontend` | Svelte 5 + TailwindCSS webview UI |
| `packages/shared` | API interface (RPC methods), RPC bridge, shared types (simulation profiles, config, container info) |

## Tech Stack

TypeScript throughout. Backend runs in Podman Desktop's Node.js/Electron host. Frontend is a Svelte 5 SPA in a webview panel. Build tooling: Vite 8, npm workspaces. Routing: tinro (hash mode). Theming: `.pai-*` CSS classes using Podman Desktop's `--pd-*` CSS variables.

## Packaging

The root `Containerfile` builds an OCI image of the extension. The backend `README.md` and icon ship inside the image and are displayed by Podman Desktop.

## Settings

10 configuration properties under **Settings → Preferences → Physical AI**:

| Preference | Purpose |
|------------|---------|
| Default namespace | Quay.io namespace for catalog and image tags |
| Catalog view mode | `all` or `curated` |
| Catalog curated allowlist | Wildcard patterns for Curated view |
| Simulation image allowlist | Optional tag/digest pins for Simulation launch |
| Topic peek timeout | Seconds for Topic Monitor Peek (1–30, default 5) |
| Image Builder defaults | Robot, distro, middleware, engine, base preset |

### Simulation image trust

Launching a simulation runs `/entrypoint-gazebo.sh` from the **local** image you select. Name/tag allowlisting is not cryptographic verification — treat local images like any other container you run. Prefer builds from **Image Builder** or pulls from your Quay namespace. Optionally set **Simulation image allowlist** to exact tags or `@sha256:…` digests for locked-down demos.

## License

Apache-2.0
