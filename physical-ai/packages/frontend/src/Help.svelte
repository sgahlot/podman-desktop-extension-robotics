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
        <p>
          Typical demo path:
          <strong>Image Builder</strong> (build base + sim) →
          <strong>Simulation</strong> (launch empty Gazebo + noVNC) →
          <strong>Add TurtleBot3</strong>.
          Or pull golden images from <strong>Image Catalog</strong>.
          Bases are <strong>Ubuntu interim</strong> today; Fedora/RHEL migration is tracked separately.
        </p>
      </div>
    </div>

    <div class="rounded-lg border border-[var(--pd-content-card-border)] bg-[var(--pd-content-card-bg)] p-4">
      <h2 class="text-lg font-medium text-[var(--pd-content-header)] mb-2">Image Catalog</h2>
      <div class="text-sm text-[var(--pd-content-text)] flex flex-col gap-2">
        <div>
          <strong>Browse repositories</strong> — Enter a Quay.io namespace and click Load. Expand any repository to see tags with size, date, and digest.
        </div>
        <div>
          <strong>All vs Curated</strong> — Default view is <strong>All</strong> (every <strong>public</strong> repo in the namespace; private Quay repos are not listed without auth). Switch to <strong>Curated</strong> to show only names matching the allowlist (default <span class="font-mono">ros2-*-base,ros2-*-turtlebot3,ros2-*-sim*</span>). Both the default view and the allowlist are configurable under Settings &rarr; Preferences &rarr; Physical AI (comma-separated patterns; <span class="font-mono">*</span> is a wildcard).
        </div>
        <div>
          <strong>Filter</strong> — Use "Filter by name" to further narrow the list.
        </div>
        <div>
          <strong>Pull images</strong> — Click Pull on any tag. Progress shows aggregated layer download status.
        </div>
        <div>
          <strong>Locally Available</strong> — Collapsible section lists images from this namespace already present locally (engine listing plus <span class="font-mono">podman images</span> merge so Podman 5 empty <span class="font-mono">RepoTags</span> still show up).
        </div>
      </div>
    </div>

    <div class="rounded-lg border border-[var(--pd-content-card-border)] bg-[var(--pd-content-card-bg)] p-4">
      <h2 class="text-lg font-medium text-[var(--pd-content-header)] mb-2">Image Builder</h2>
      <div class="text-sm text-[var(--pd-content-text)] flex flex-col gap-2">
        <div>
          <strong>Quick Start</strong> — <span class="font-mono">TurtleBot3 Sim (Jazzy)</span> sets dropdowns, saves preferences, and scrolls to Phase 1. Then click Build for Phase 1 and Phase 2.
        </div>
        <div>
          <strong>Configure</strong> — Select ROS distro (Humble or Jazzy), robot, middleware, engine, and base preset. Save persists to Preferences.
        </div>
        <div>
          <strong>Phase 1: Base Image</strong> — Humble: <span class="font-mono">sloretz</span> (<span class="font-mono">:sloretz</span>) or <span class="font-mono">osrf</span> (<span class="font-mono">:osrf</span>). Jazzy: Ubuntu Noble preset (tag <span class="font-mono">:noble</span>). Official Jazzy amd64 preset uses tag <span class="font-mono">:latest</span>.
        </div>
        <div>
          <strong>Phase 2: Simulation Image</strong> — Layers Gazebo, Nav2, TurtleBot3 (and noVNC for Jazzy) on your Phase 1 local base. Disabled until the base exists locally.
        </div>
        <div>
          <strong>Cancel / Push</strong> — Cancel aborts an in-progress <strong>build</strong> or <strong>push</strong>. Push requires registry login via Podman Desktop &rarr; Settings &rarr; Registries. Image Builder also shows whether the current <span class="font-mono">quay.io/…</span> tag exists on Quay (public repos only; private repos show as unavailable).
        </div>
      </div>
    </div>

    <div class="rounded-lg border border-[var(--pd-content-card-border)] bg-[var(--pd-content-card-bg)] p-4">
      <h2 class="text-lg font-medium text-[var(--pd-content-header)] mb-2">Simulation</h2>
      <div class="text-sm text-[var(--pd-content-text)] flex flex-col gap-2">
        <div>
          <strong>Launch</strong> — Pick a local sim image (tags matching <span class="font-mono">ros2-*-sim*</span> or <span class="font-mono">ros2-*-turtlebot3</span>). The container starts Gazebo + noVNC. The world is <strong>empty</strong> until you add a robot.
        </div>
        <div>
          <strong>Open in Browser</strong> — Opens noVNC (default port 6080) to view Gazebo.
        </div>
        <div>
          <strong>Add TurtleBot3</strong> — Spawns a robot into the running world via <span class="font-mono">podman exec</span> (name + X/Y/yaw).
        </div>
      </div>
    </div>

    <div class="rounded-lg border border-[var(--pd-content-card-border)] bg-[var(--pd-content-card-bg)] p-4">
      <h2 class="text-lg font-medium text-[var(--pd-content-header)] mb-2">Golden Quay images</h2>
      <div class="text-sm text-[var(--pd-content-text)] flex flex-col gap-1">
        <p>Recommended set to publish for Catalog demos (replace <span class="font-mono">&lt;ns&gt;</span> with your namespace):</p>
        <p class="font-mono text-xs">quay.io/&lt;ns&gt;/ros2-humble-base:sloretz</p>
        <p class="font-mono text-xs">quay.io/&lt;ns&gt;/ros2-humble-base:osrf</p>
        <p class="font-mono text-xs">quay.io/&lt;ns&gt;/ros2-jazzy-base:latest</p>
        <p class="font-mono text-xs">quay.io/&lt;ns&gt;/ros2-jazzy-base:noble</p>
        <p class="font-mono text-xs">quay.io/&lt;ns&gt;/ros2-humble-turtlebot3:sloretz</p>
        <p class="font-mono text-xs">quay.io/&lt;ns&gt;/ros2-jazzy-sim:noble</p>
      </div>
    </div>

    <div class="rounded-lg border border-[var(--pd-content-card-border)] bg-[var(--pd-content-card-bg)] p-4">
      <h2 class="text-lg font-medium text-[var(--pd-content-header)] mb-2">Tips</h2>
      <div class="text-sm text-[var(--pd-content-text)] flex flex-col gap-1">
        <p>&#8226; Arch warnings appear only when the selected preset does not support your host architecture.</p>
        <p>&#8226; Pull progress may jump as layers are discovered — that is normal.</p>
        <p>&#8226; The extension remembers your last visited page.</p>
        <p>&#8226; For Gazebo on Mac, prefer Jazzy Noble over Humble (avoids QEMU).</p>
      </div>
    </div>

    <div class="rounded-lg border border-[var(--pd-content-card-border)] bg-[var(--pd-content-card-bg)] p-4">
      <h2 class="text-lg font-medium text-[var(--pd-content-header)] mb-2">Coming Soon</h2>
      <div class="text-sm text-[var(--pd-content-text)] flex flex-col gap-1">
        <p><strong>Customize hardware</strong> — Swap sensors (e.g. camera) on a running robot (Story 6 stretch).</p>
        <p><strong>Additional robots</strong> — Beyond TurtleBot3 (planned; see project plan).</p>
        <p><strong>Fleet</strong> — Multi-robot local fleets with Zenoh.</p>
        <p><strong>OpenShift Bridge</strong> — Export to Kubernetes / OpenShift (Kind path parked for now).</p>
      </div>
    </div>

  </div>
</div>
