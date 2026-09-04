# Physical AI — Podman Desktop Extension

Developer README for the `physical-ai/` npm workspace. **User-facing documentation** (features, quick start, Navigate, OpenShift CPU sizing, GPU notes, settings) lives in **[`packages/backend/README.md`](packages/backend/README.md)** — that file ships inside the published extension OCI image and is what Podman Desktop displays. Edit there for extension-user docs; keep this file for build, install-from-source, and repo layout.

## Quick start (developers)

### Option A — published image (no build)

Podman Desktop → Extensions → **Install custom extension…** → `quay.io/sgahlot/physical-ai-extension:latest`

### Option B — build from source

**Prerequisites**

| Requirement | Minimum | Recommended | Notes |
|-------------|---------|-------------|-------|
| [Podman Desktop](https://podman-desktop.io/) | 1.28.0 | 1.29+ | Tested with 1.28.x and 1.29.x |
| Podman | 5.x | 6.0+ | Tested with 5.8.5 and 6.0.2 |
| Node.js | 24.0.0 | 24.x | Matches Podman Desktop's Node requirement |
| npm | 11.0.0 | 11.x | |

**Podman Machine** (for local simulation)

| Resource | Minimum | Recommended | Notes |
|----------|---------|-------------|-------|
| CPUs | 4 | 6+ | Gazebo + noVNC; arm64 Mac uses virtio-gpu by default (llvmpipe fallback if passthrough disabled) |
| Memory | 4 GB | 8 GB | Single sim container uses ~2.5–3 GB. Default ~5.7 GB works for 1–2 robots. Increase for 3+ robots. |
| Disk | 30 GB | 50+ GB | Base image ~1.5 GB, sim image ~3 GB, plus build cache layers |

Adjust with `podman machine set --memory 8192 --cpus 6` or **Settings → Resources → Podman Machine** in Podman Desktop.

On Mac Apple Silicon, Podman Machine uses LibKrun with virtio-gpu (API translation to Metal). Simulation launch passes `/dev/dri` by default on arm64 and uses hardware rendering when available; disable **Simulation GPU passthrough** in Preferences to force `llvmpipe`. For in-simulation CPU/GPU sizing, OpenShift deploy, and Navigate behavior, see [`packages/backend/README.md`](packages/backend/README.md).

**Build**

```bash
npm install
npm run build
```

**Load in Podman Desktop**

1. Enable **Development Mode**: *Settings → Preferences → Extensions → Development Mode*

   ![Enable Development Mode](../docs/images/enable-dev-mode.png)

2. Navigate to **Extensions** in the left nav.
3. Open the **Local extension** tab.
4. Click **Add a local folder…** and select **`packages/backend`** (relative to this `physical-ai/` directory) — not this workspace root. Only `packages/backend/package.json` declares the `podman-desktop` engine version. Selecting the top-level folder fails with:

   ```
   Error: Extension with id redhat.physical-ai is not compatible with Podman Desktop. It requires 'podman-desktop' engine.
   ```

5. The **Physical AI** extension appears in the navbar.

   ![Physical AI Extension](../docs/images/physical-ai-extension.png)

**Don't** build the root `Containerfile` locally and paste that tag into **Install custom extension…** — that flow always pulls from a registry. Use Option B for local changes; use `scripts/publish-extension-image.sh` when you need a pushed OCI image.

## Project structure

Repo-level plan, design, and story tracking live in [`../docs/`](../docs/) (outside this npm workspace).

| Path | Purpose |
|------|---------|
| `packages/backend` | Extension entrypoint, RPC API, bundled container assets; **canonical user README** |
| `packages/frontend` | Svelte 5 + TailwindCSS webview UI |
| `packages/shared` | API interface, RPC bridge, shared types |
| `packages/cli` | Standalone CLI — see [`packages/cli/README.md`](packages/cli/README.md) |
| `docs/img/` | Screenshots and GIFs referenced by the backend README |

## Tech stack

| Component | Technology |
|-----------|------------|
| Extension framework | Podman Desktop Extension API |
| Language | TypeScript |
| Frontend | Svelte 5, TailwindCSS, `@podman-desktop/ui-svelte` |
| Build | Vite 8, npm workspaces |
| Testing | Vitest 4 |
| Routing | tinro (hash mode) |
| Theming | `.pai-*` CSS classes using Podman Desktop `--pd-*` variables |
| Container images | Ubuntu 24.04 + ROS2 Jazzy (Humble exists, not currently verified working) |
| Registry | Quay.io |
| Middleware | Zenoh / DDS |
| Simulation | Gazebo |

Backend runs in Podman Desktop's Node.js/Electron host. Frontend is a Svelte 5 SPA in a webview panel.

## Packaging

The root `Containerfile` builds an OCI image of the extension. `packages/backend/README.md` and the icon ship inside the image. Publish via `scripts/publish-extension-image.sh`.

## Troubleshooting (install / dev)

- **Wrong folder selected** — must be `packages/backend`, not `physical-ai/`.
- **Extension won't load after build** — run `npm run build` from this directory; reload the extension in Podman Desktop.
- **Simulation / OpenShift / Navigate issues** — see [`packages/backend/README.md`](packages/backend/README.md) and in-extension **Help**.

## License

Apache-2.0
