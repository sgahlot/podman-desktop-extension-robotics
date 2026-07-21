# Story 1: Extension Scaffolding and Base Image Catalog — ✅ Done

**Jira:** APPENG-5764 | **Parent:** APPENG-5763 (Epic)

**Description:** Build the Podman Desktop extension shell (registration, navigation, branding). Integrate a curated catalog of Fedora/ROS2 base images pullable from Quay. Include a project creation wizard to select robot type, middleware (Zenoh/DDS), and simulation engine.

---

## Sub-task Progress

| Status | Key | Summary |
|--------|-----|---------|
| ✅ | APPENG-5768 | Scaffold Podman Desktop extension with TypeScript/Svelte boilerplate |
| ✅ | APPENG-5769 | Build and publish Fedora + ROS2 Jazzy base image to Quay |
| ✅ | APPENG-5770 | Implement image catalog UI with pull and status indicators |

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

## APPENG-5769: Build ROS2 Jazzy Base Image — ✅ Done

**Description:** Build a container image with ROS2 Jazzy core runtime and convenience tools (colcon, rosdep). Publish to Quay registry.

**Completed:** 2026-07-21

### What was done

- Created `containers/ros2-jazzy-base/` with Containerfile, entrypoint, and README
- Based on `ros:jazzy-ros-base` (official Ubuntu 24.04 image)
- Includes: colcon, rosdep (pre-initialized), vcstool, cmake, build-essential, git
- Entrypoint sources `/opt/ros/jazzy/setup.bash` automatically
- Working directory set to `/ros2_ws`

### Key files

```
containers/ros2-jazzy-base/
├── Containerfile     # Image definition
├── entrypoint.sh     # Sources ROS2 setup, execs CMD
└── README.md         # Build/run/publish instructions
```

### Decisions made

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Base OS | Ubuntu 24.04 (interim) | ROS2 Jazzy not officially supported on Fedora; Ubuntu has official images |
| rviz2 | Excluded | Requires full desktop stack (OpenGL, Qt5, X11); planned as separate "desktop" variant |
| Location | `containers/ros2-jazzy-base/` | Standard multi-image convention; root Containerfile stays for extension OCI packaging |

### Future work

- **Migrate to Fedora base** — once ROS2 Jazzy Fedora packaging matures (COPR repos or source build)
- **Add rviz2/desktop variant** — separate image with GUI dependencies for visualization

---

## APPENG-5770: Image Catalog UI — ✅ Done

**Description:** Build the UI within the extension to browse curated base images, pull them from Quay, and show download/status indicators.

**Completed:** 2026-07-21

### What was done

- Image Catalog page browsing Quay.io namespace with paginated repository listing
- Client-side name filter for repositories
- Expandable repo rows showing tags with size, date, and digest
- Pull images from Quay via Podman with real-time progress bar (fire-and-forget + polling pattern)
- Per-layer download progress aggregated into smooth totals with percentage display
- "Locally Available" collapsible section showing local images matching the namespace (scrollable, max 10 visible)
- Green "✓ Local" badge on tag rows for already-pulled images, with "Pull again" option
- Refresh button to re-check local images without leaving the page
- Error handling with truncated messages, tooltips, and retry links
- Auto-refresh of local images after each successful pull

### Key files

```
packages/frontend/src/ImageCatalog.svelte   # Full catalog page (browse, pull, progress, local detection)
packages/backend/src/api-impl.ts            # Backend: Quay API, pull with progress, local image listing
packages/shared/src/PhysicalAiApi.ts        # API contract (6 methods)
packages/shared/src/types/ImageCatalog.ts   # Shared types (QuayRepository, QuayTag, PullProgress)
```

### Key learnings

- Podman Desktop webview does NOT deliver unsolicited backend-to-frontend messages — use polling instead of pub/sub
- Svelte 5 reactivity with Map/Set requires passing the collection as an explicit template argument
- Tailwind CSS classes don't render in Podman Desktop webviews — use inline styles
