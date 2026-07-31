# Physical AI — Podman Desktop Extension

A Podman Desktop extension that gives robotics developers a GUI-driven path from local development to container deployment — no CLI required.

## Features

- **Image Catalog** — Browse and pull ROS2 images from Quay.io (All or Curated view)
- **Image Builder** — Two-phase build (base + simulation) with Quick Start presets. Phase 1 builds the ROS2 base, Phase 2 layers Gazebo + Nav2 + noVNC on top.
- **Simulation** — One-click launch of Gazebo in a Podman container, browser-based visualization via noVNC, interactive TurtleBot3 spawning
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

Simulation uses software rendering (llvmpipe) — no GPU required. Default Podman Machine (~5.7 GB) is fine for 1–2 robots. For 3+ robots, increase to 8 GB: `podman machine set --memory 8192`.

See [`packages/backend/README.md`](packages/backend/README.md) for platform-specific notes (Mac Apple Silicon, Linux).

## Quick Start

```bash
npm install
npm run build
```

1. Load the extension from `packages/backend` in Podman Desktop (Settings → Extensions → Local extension)
2. Open **Physical AI** (or **F1** → **Physical AI: Open Dashboard**)
3. **Image Builder** → Quick Start **TurtleBot3 Sim (Jazzy)** → Phase 1 Build → Phase 2 Build
4. **Simulation** → Launch → Open in Browser → Add TurtleBot3

## Project Structure

| Path | Purpose |
|------|---------|
| `packages/backend` | Extension entrypoint, RPC API, bundled container assets (Containerfiles, entrypoints, world files) |
| `packages/frontend` | Svelte 5 + TailwindCSS webview UI |
| `packages/shared` | API interface (27 methods), RPC bridge, shared types (simulation profiles, config, container info) |

## Tech Stack

TypeScript throughout. Backend runs in Podman Desktop's Node.js/Electron host. Frontend is a Svelte 5 SPA in a webview panel. Build tooling: Vite 8, npm workspaces. Routing: tinro (hash mode). Theming: `.pai-*` CSS classes using Podman Desktop's `--pd-*` CSS variables.

## Packaging

The root `Containerfile` builds an OCI image of the extension. The backend `README.md` and icon ship inside the image and are displayed by Podman Desktop.

## Settings

8 configuration properties under **Settings → Preferences → Physical AI**: default namespace, catalog view mode, curated allowlist, and Image Builder defaults (robot, distro, middleware, engine, base preset).

## License

Apache-2.0
