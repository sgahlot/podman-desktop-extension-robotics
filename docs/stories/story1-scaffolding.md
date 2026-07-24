# Story 1: Extension Scaffolding and Base Image Catalog — ✅ Done

**Jira:** APPENG-5764 | **Parent:** APPENG-5763 (Epic)

**Description:** Build the Podman Desktop extension shell (registration, navigation, branding). Integrate a curated catalog of Fedora/ROS2 base images pullable from Quay. Include a project creation wizard to select robot type, middleware (Zenoh/DDS), and simulation engine.

---

## Sub-task Progress

| Status | Key | Summary |
|--------|-----|---------|
| ✅ | APPENG-5768 | Scaffold Podman Desktop extension with TypeScript/Svelte boilerplate |
| ✅ | APPENG-5769 | Build and publish ROS2 Jazzy base image to Quay |
| ✅ | APPENG-5770 | Implement image catalog UI with pull and status indicators |
| ✅ | APPENG-5808 | Project creation wizard and simulation image setup |

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

**Container image:**
- Created `containers/ros2-jazzy-base/` with Containerfile, entrypoint, and README
- Based on `ros:jazzy-ros-base` (official Ubuntu 24.04 image)
- Includes: colcon, rosdep (pre-initialized), vcstool, cmake, build-essential, git
- Entrypoint sources `/opt/ros/jazzy/setup.bash` automatically
- Working directory set to `/ros2_ws`

**Build & Push UI in extension:**
- "Build & Push Base Image" page accessible from Dashboard card
- Build: fires `containerEngine.buildImage()` with bundled Containerfile assets, streams build logs, shows step progress bar (STEP N/M parsing)
- Push: fires `containerEngine.pushImage()` with animated indeterminate progress bar (Podman Desktop push API only provides start/end callbacks, no intermediate progress)
- Push success displays image tag and full SHA256 digest
- Detects existing local images: shows "Rebuild" instead of "Build", enables push without rebuilding
- Build logs are collapsible with line count
- Registry authentication must be configured via Podman Desktop Settings → Registries (not CLI `podman login`)
- Containerfile assets bundled in `packages/backend/assets/ros2-jazzy-base/` for runtime access via `extensionContext.extensionUri`
- Help page updated with Build & Push documentation
- API contract extended with `buildBaseImage()`, `getBuildProgress()`, `pushImage()`, `getPushProgress()` (10 methods total)

### Key files

```
containers/ros2-jazzy-base/
├── Containerfile     # Image definition
├── entrypoint.sh     # Sources ROS2 setup, execs CMD
└── README.md         # Build/run/publish instructions

packages/frontend/src/BuildBaseImage.svelte       # Build & push page with progress and logs
packages/frontend/src/Dashboard.svelte            # "Build & Push Base Image" card
packages/frontend/src/Help.svelte                 # Build & push documentation section
packages/backend/src/api-impl.ts                  # Build and push implementation
packages/backend/assets/ros2-jazzy-base/          # Bundled Containerfile and entrypoint for builds
packages/shared/src/PhysicalAiApi.ts              # API contract (10 methods)
packages/shared/src/types/ImageCatalog.ts         # BuildProgress, PushProgress types
Containerfile                                     # Updated to COPY assets into extension OCI image
```

### Decisions made

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Base OS | Ubuntu 24.04 (interim) | ROS2 Jazzy not officially supported on Fedora; Ubuntu has official images |
| rviz2 | Excluded | Requires full desktop stack (OpenGL, Qt5, X11); planned as separate "desktop" variant |
| Location | `containers/ros2-jazzy-base/` | Standard multi-image convention; root Containerfile stays for extension OCI packaging |

### Key learnings

- `extensionContext.extensionUri` resolves to `packages/backend/` during development — assets must be placed there, not at repo root
- `containerEngine.pushImage()` expects image name:tag as second param, not the hex SHA ID
- Push callback only fires at start and end (no intermediate layer progress) — use an indeterminate animated progress bar
- On macOS, `podman login` from host CLI may not share credentials with the Podman machine VM — use Podman Desktop Settings → Registries instead
- Push callback data may contain multiple newline-separated JSON objects in a single chunk — split before parsing

### Follow-up tasks

| Status | Key | Summary |
|--------|-----|---------|
| 🅿️ | APPENG-5809 | Migrate ROS2 Jazzy base image from Ubuntu to Fedora |
| 🅿️ | APPENG-5810 | Add rviz2/desktop variant of the base image |

- **APPENG-5809 (Parked):** Jazzy has no official Fedora packages ([REP 2000](https://reps.openrobotics.org/rep-2000/) — Ubuntu Noble Tier 1, RHEL 9 Tier 2). COPR/from-source is development-only. Note: official Jazzy RPMs **do** exist for RHEL 9 — a UBI/RHEL base is closer to a Red Hat path than waiting on Fedora. Revisit on concrete triggers (official Fedora binaries, Red Hat–blessed COPR/SIG, or deliberate RHEL/UBI strategy). Full notes + sources: [podman-extension-plan.md](../podman-extension-plan.md#follow-up-tasks-from-appeng-5769-scope-adjustments).
- **APPENG-5810 (Parked):** rviz2 needs a full GUI stack and a much larger image. Partial overlap with Story 2 noVNC/Gazebo (APPENG-5772) — sim viz ≠ TF/sensor debug. Revisit after APPENG-5772. Community Fedora Jazzy COPRs often omit rviz2 entirely.

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
packages/shared/src/PhysicalAiApi.ts        # API contract (10 methods)
packages/shared/src/types/ImageCatalog.ts   # Shared types (QuayRepository, QuayTag, PullProgress)
```

### Key learnings

- Podman Desktop webview does NOT deliver unsolicited backend-to-frontend messages — use polling instead of pub/sub
- Svelte 5 reactivity with Map/Set requires passing the collection as an explicit template argument
- Tailwind layout utilities (flex, gap, padding) work via the built CSS bundle; Tailwind *color* utilities (e.g. `text-purple-500`, `text-gray-900`) do not theme with Podman Desktop. Prefer `--pd-*` variables and shared `.pai-*` classes in `app.css` for colors and buttons. Full adoption of `@podman-desktop/ui-svelte` remains optional.

---

## APPENG-5808: Project Creation Wizard and Simulation Image Setup — ✅ Done

**Description:** Build a wizard UI for selecting robot type, ROS distro, middleware, and simulation engine. Create corresponding simulation Containerfiles. Persist selections for Story 2 (APPENG-5771) to consume when launching simulations.

### Implementation Parts

| Status | Part | Summary |
|--------|------|---------|
| ✅ | Part 1 | Simulation Containerfile |
| ✅ | Part 2 | Wizard UI |
| ✅ | Part 3 | Wire Build & Push |

---

#### Part 1 — Simulation Containerfile (TurtleBot3 + Gazebo)

Create `containers/ros2-humble-turtlebot3/Containerfile` baking in the manual setup from `side-work/`:
- Base: `ghcr.io/sloretz/ros:humble-desktop`
- Install Gazebo packages, ros-gz bridge, nav2 (from `setup-01.sh`)
- Clone TurtleBot3 repos: core, msgs, DynamixelSDK, simulations (from `setup-02.sh`)
- Run `colcon build` with COLCON_IGNORE on turtlebot3_gazebo (from `build.sh`)
- Entrypoint sourcing ROS2 Humble setup

Bundle in `packages/backend/assets/ros2-humble-turtlebot3/` for extension access (same pattern as ros2-jazzy-base).

**Source material** — manual scripts in `podman-work/side-work/`:
- `setup-01.sh` — Gazebo repo setup + apt install ros-humble-ros-gz, ros-humble-nav2-bringup
- `setup-02.sh` — git clone turtlebot3, turtlebot3_msgs, DynamixelSDK, turtlebot3_simulations (all humble branch)
- `build.sh` — colcon build with COLCON_IGNORE on turtlebot3_gazebo, parallel-workers 2
- `podman.txt` — `podman run` with `--ipc=host --net=host`, volume mount to host workspace

---

#### Part 2 — Wizard UI (extension page)

- New "Simulation Setup" page accessible from Dashboard
- Selection options:
  - **Robot type:** TurtleBot3 (initial), extensible to other robots later
  - **ROS distro:** Humble (for simulation/desktop), Jazzy (for base/headless)
  - **Middleware:** DDS (default), Zenoh (future)
  - **Simulation engine:** Gazebo (initial)
- Persist selections via extension configuration (PD Configuration API)
- Dashboard card linking to the new page
- Selections feed into Story 2's one-click launch (APPENG-5771)

---

#### Part 3 — Wire Build & Push

- Backend API method to build the simulation image using the TurtleBot3 Containerfile
- Update Build & Push page to support multiple image types (base image vs simulation image), or add build/push controls directly to the wizard page
- Reuse existing build progress polling and push flow

---

### Relationship to Story 2

- This task creates the **image and UI** for selecting a simulation setup
- APPENG-5771 (Story 2) **consumes** the wizard selections and image to orchestrate the one-click launch
- APPENG-5772 (Story 2) provides the **visualization** of the running simulation
