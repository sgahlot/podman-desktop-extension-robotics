<script lang="ts">
import { router } from 'tinro';
</script>

<div class="flex flex-col p-4 gap-4 h-full overflow-auto">
  <button on:click={() => router.goto('/')} class="pai-link self-start">
    &larr; Back to Dashboard
  </button>
  <h1 class="text-3xl text-[var(--pd-content-header)]">Help</h1>
  <p class="text-sm text-[var(--pd-content-text)]">
    Quick guide to using the Physical AI extension for Podman Desktop.
  </p>

  <div class="flex flex-col gap-4">

    <div class="rounded-lg border border-[var(--pd-content-card-border)] bg-[var(--pd-content-card-bg)] p-4">
      <h2 class="text-lg font-medium text-[var(--pd-content-header)] mb-2">Getting Started</h2>
      <div class="text-sm text-[var(--pd-content-text)] flex flex-col gap-1">
        <p>Physical AI gives robotics developers a GUI-driven path from local development to OpenShift deployment — no terminal required.</p>
        <p>Start by browsing and pulling curated ROS2 base images from the <strong>Image Catalog</strong>.</p>
      </div>
    </div>

    <div class="rounded-lg border border-[var(--pd-content-card-border)] bg-[var(--pd-content-card-bg)] p-4">
      <h2 class="text-lg font-medium text-[var(--pd-content-header)] mb-2">Image Catalog</h2>
      <div class="text-sm text-[var(--pd-content-text)] flex flex-col gap-2">
        <div>
          <strong>Browse repositories</strong> — Enter a Quay.io namespace (default: <span class="font-mono">ecosystem-appeng</span>) and click Load. Expand any repository to see its available tags with size, date, and digest.
        </div>
        <div>
          <strong>Filter</strong> — Use the "Filter by name" field to narrow the repository list. This filters the repo list only, not the Locally Available section.
        </div>
        <div>
          <strong>Pull images</strong> — Click the Pull button on any tag. A progress bar shows real-time download status with percentage. The bar tracks aggregated progress across all image layers.
        </div>
        <div>
          <strong>Locally Available</strong> — The collapsible section at the top shows images from the current namespace that are already in your local Podman registry. Tags that exist locally display a green "&#10003; Local" badge with a "Pull again" option.
        </div>
        <div>
          <strong>Refresh</strong> — Click the "&#8635; Refresh" button in the Locally Available header to re-check which images exist locally. Useful after deleting images from the CLI.
        </div>
        <div>
          <strong>Errors</strong> — If a pull fails, the error is shown inline with a Retry link.
        </div>
      </div>
    </div>

    <div class="rounded-lg border border-[var(--pd-content-card-border)] bg-[var(--pd-content-card-bg)] p-4">
      <h2 class="text-lg font-medium text-[var(--pd-content-header)] mb-2">Image Builder</h2>
      <div class="text-sm text-[var(--pd-content-text)] flex flex-col gap-2">
        <div>
          <strong>Configure</strong> — Select your ROS distro (Humble or Jazzy), robot type, middleware, simulation engine, and base image preset. Click Save to persist your selections.
        </div>
        <div>
          <strong>Selections persist</strong> — Your configuration is saved in Podman Desktop settings and will be remembered across sessions. You can also view and edit these values in Settings &rarr; Preferences &rarr; Physical AI.
        </div>
        <div>
          <strong>Phase 1: Base Image</strong> — Build the ROS2 base image (build tools, rosdep, colcon). Available for both Humble and Jazzy. Click Build, then optionally Push to Registry.
        </div>
        <div>
          <strong>Phase 2: Simulation Image</strong> — Once the base image exists locally, build the simulation image on top of it (adds Gazebo, Nav2, TurtleBot3). Currently available for Humble only. The Build button is disabled until Phase 1 completes.
        </div>
        <div>
          <strong>Cancel</strong> — Click Cancel to abort an in-progress build at any time.
        </div>
        <div>
          <strong>Push</strong> — After a successful build, or if the image already exists locally, click "Push to Registry" to push it. Registry authentication must be configured via Podman Desktop &rarr; Settings &rarr; Registries.
        </div>
      </div>
    </div>

    <div class="rounded-lg border border-[var(--pd-content-card-border)] bg-[var(--pd-content-card-bg)] p-4">
      <h2 class="text-lg font-medium text-[var(--pd-content-header)] mb-2">Tips</h2>
      <div class="text-sm text-[var(--pd-content-text)] flex flex-col gap-1">
        <p>&#8226; The progress percentage may start low and adjust upward as new image layers are discovered during download — this is normal.</p>
        <p>&#8226; After a successful pull, the Locally Available section and tag badges update automatically.</p>
        <p>&#8226; You can pull multiple images at the same time — each tracks progress independently.</p>
        <p>&#8226; The extension remembers your last visited page, so you'll return to where you left off.</p>
      </div>
    </div>

    <div class="rounded-lg border border-[var(--pd-content-card-border)] bg-[var(--pd-content-card-bg)] p-4">
      <h2 class="text-lg font-medium text-[var(--pd-content-header)] mb-2">Coming Soon</h2>
      <div class="text-sm text-[var(--pd-content-text)] flex flex-col gap-1">
        <p><strong>Simulation</strong> — One-click launch of ROS2 + Gazebo simulations with browser-based visualization.</p>
        <p><strong>Fleet</strong> — Scale to multi-robot local fleets with Zenoh middleware and a fleet status dashboard.</p>
        <p><strong>OpenShift Bridge</strong> — Export Podman configurations to Kubernetes manifests and deploy to OpenShift.</p>
      </div>
    </div>

  </div>
</div>
