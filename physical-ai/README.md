# Physical AI (monorepo)

Podman Desktop extension for Physical AI robotics development.

| Path | Purpose |
|------|---------|
| `packages/backend` | Extension entrypoint, RPC API, bundled assets, **shipped README / icon** |
| `packages/frontend` | Svelte webview UI |
| `packages/shared` | Shared types and RPC helpers |

## Development

```bash
npm install
npm run build
```

Load the built extension from `packages/backend` in Podman Desktop.  
Command palette (**F1**): **Physical AI: Open Dashboard**.

Extension documentation that ships in the OCI image: [`packages/backend/README.md`](packages/backend/README.md).

## Packaging

The root `Containerfile` builds an OCI image of the extension (dist, media, assets, backend `package.json` / `README.md` / `icon.png`).
