# Physical AI — Podman Desktop Extension

Developer README for the `physical-ai/` npm workspace. **User-facing documentation** (features, quick start, Navigate, OpenShift CPU sizing, GPU notes, settings) lives in **[`packages/backend/README.md`](packages/backend/README.md)** — that file ships inside the published extension OCI image and is what Podman Desktop displays. Edit there for extension-user docs; keep this file for build, install-from-source, and repo layout.

## Install (developers)

**Option A — published image (no build):** Podman Desktop → Extensions → **Install custom extension…** → `quay.io/sgahlot/physical-ai-extension:latest`

**Option B — build from source:**

```bash
npm install
npm run build
```

Then **Settings → Extensions → Install a new extension from a local folder** and select **`packages/backend`** — not this workspace root. Both folders have a `package.json` named `physical-ai`, but only `packages/backend/package.json` declares the `podman-desktop` engine version. Selecting the top-level folder fails with:

```
Error: Extension with id redhat.physical-ai is not compatible with Podman Desktop. It requires 'podman-desktop' engine.
```

**Don't** build the root `Containerfile` locally and paste that tag into **Install custom extension…** — that flow always pulls from a registry. Use Option B for local changes; use `scripts/publish-extension-image.sh` when you need a pushed OCI image.

## Build prerequisites

| Requirement | Minimum | Recommended |
|-------------|---------|-------------|
| Podman Desktop | 1.28+ | 1.29+ |
| Podman | 5.x or 6.x | 6.0+ |
| Node.js | 24.0.0 | 24.x (matches Podman Desktop) |

For simulation runtime prerequisites (Podman Machine CPUs/memory, platform notes), see [`packages/backend/README.md`](packages/backend/README.md).

## Project structure

| Path | Purpose |
|------|---------|
| `packages/backend` | Extension entrypoint, RPC API, bundled container assets; **canonical user README** |
| `packages/frontend` | Svelte 5 + TailwindCSS webview UI |
| `packages/shared` | API interface, RPC bridge, shared types |
| `packages/cli` | Standalone CLI — see [`packages/cli/README.md`](packages/cli/README.md) |
| `docs/img/` | Screenshots and GIFs referenced by the backend README |

## Tech stack

TypeScript throughout. Backend runs in Podman Desktop's Node.js/Electron host. Frontend is a Svelte 5 SPA in a webview panel. Build tooling: Vite 8, npm workspaces. Routing: tinro (hash mode). Theming: `.pai-*` CSS classes using Podman Desktop's `--pd-*` CSS variables.

## Packaging

The root `Containerfile` builds an OCI image of the extension. `packages/backend/README.md` and the icon ship inside the image. Publish via `scripts/publish-extension-image.sh`.

## Troubleshooting (install / dev)

- **Wrong folder selected** — must be `packages/backend`, not `physical-ai/`.
- **Extension won't load after build** — run `npm run build` from this directory; reload the extension in Podman Desktop.
- **Simulation / OpenShift / Navigate issues** — see [`packages/backend/README.md`](packages/backend/README.md) and in-extension **Help**.

## License

Apache-2.0
