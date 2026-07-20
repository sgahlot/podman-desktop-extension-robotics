# Story 1: Extension Scaffolding and Base Image Catalog — 🟡 In Progress

**Jira:** APPENG-5764 | **Parent:** APPENG-5763 (Epic)

**Description:** Build the Podman Desktop extension shell (registration, navigation, branding). Integrate a curated catalog of Fedora/ROS2 base images pullable from Quay. Include a project creation wizard to select robot type, middleware (Zenoh/DDS), and simulation engine.

---

## Sub-task Progress

| Status | Key | Summary |
|--------|-----|---------|
| ✅ | APPENG-5768 | Scaffold Podman Desktop extension with TypeScript/Svelte boilerplate |
| ⚪ | APPENG-5769 | Build and publish Fedora + ROS2 Jazzy base image to Quay |
| ⚪ | APPENG-5770 | Implement image catalog UI with pull and status indicators |

---

## APPENG-5768: Scaffold Extension — ✅ Done

**Description:** Set up the Podman Desktop extension project structure, registration, and basic navigation shell.

**Completed:** 2026-07-17

### What was done

- Scaffolded the `physical-ai/` extension using the official [full template](https://github.com/podman-desktop/podman-desktop-extension-full-template) as reference
- 3-package monorepo: `packages/backend`, `packages/frontend`, `packages/shared`
- Backend: `extension.ts` creates a webview panel, wires RPC bridge to `PhysicalAiApiImpl`
- Frontend: Svelte 5 + TailwindCSS dashboard with placeholder cards for Image Catalog, Simulation, and Fleet
- Shared: Full `MessageProxy` RPC bridge for frontend-backend communication
- `Containerfile` for OCI packaging
- Build verified: `npm run build` compiles both frontend and backend cleanly

### Key files

```
physical-ai/
├── packages/backend/src/extension.ts      # Entry point (activate/deactivate)
├── packages/backend/src/api-impl.ts       # PhysicalAiApiImpl stub
├── packages/backend/package.json          # Extension manifest
├── packages/frontend/src/App.svelte       # Root component with routing
├── packages/frontend/src/Dashboard.svelte # Landing page
├── packages/frontend/src/api/client.ts    # RPC client setup
├── packages/shared/src/PhysicalAiApi.ts   # API interface
├── packages/shared/src/messages/MessageProxy.ts  # RPC bridge
└── Containerfile                          # OCI image build
```

### Decisions made

See [Decisions and Directions](../podman-extension-plan.md#decisions-and-directions-appeng-5768-scaffolding) in the main plan doc.

---

## APPENG-5769: Build Fedora + ROS2 Base Image — ⚪ Not Started

**Description:** Build a Fedora-based container image with ROS2 Jazzy core runtime and convenience tools (colcon, rosdep, rviz2). Publish to Quay registry.

*No work done yet.*

---

## APPENG-5770: Image Catalog UI — ⚪ Not Started

**Description:** Build the UI within the extension to browse curated base images, pull them from Quay, and show download/status indicators.

*No work done yet.*
