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
        <p>Start with <strong>Image Builder</strong> to build/push ROS2 images, or <strong>Image Catalog</strong> to pull from Quay. Container bases are <strong>Ubuntu interim</strong> today; Fedora/RHEL migration is tracked separately.</p>
      </div>
    </div>

    <div class="rounded-lg border border-[var(--pd-content-card-border)] bg-[var(--pd-content-card-bg)] p-4">
      <h2 class="text-lg font-medium text-[var(--pd-content-header)] mb-2">Image Catalog</h2>
      <div class="text-sm text-[var(--pd-content-text)] flex flex-col gap-2">
        <div>
          <strong>Browse repositories</strong> — Enter a Quay.io namespace and click Load. Expand any repository to see tags with size, date, and digest.
        </div>
        <div>
          <strong>All vs Curated</strong> — Default view is <strong>All</strong> (every public repo in the namespace). Switch to <strong>Curated</strong> to show only names matching the allowlist (default <span class="font-mono">ros2-*-base,ros2-*-turtlebot3</span>). Both the default view and the allowlist are configurable under Settings &rarr; Preferences &rarr; Physical AI (comma-separated patterns; <span class="font-mono">*</span> is a wildcard).
        </div>
        <div>
          <strong>Filter</strong> — Use "Filter by name" to further narrow the list.
        </div>
        <div>
          <strong>Pull images</strong> — Click Pull on any tag. Progress shows aggregated layer download status.
        </div>
        <div>
          <strong>Locally Available</strong> — Collapsible section lists images from this namespace already present locally.
        </div>
      </div>
    </div>

    <div class="rounded-lg border border-[var(--pd-content-card-border)] bg-[var(--pd-content-card-bg)] p-4">
      <h2 class="text-lg font-medium text-[var(--pd-content-header)] mb-2">Image Builder</h2>
      <div class="text-sm text-[var(--pd-content-text)] flex flex-col gap-2">
        <div>
          <strong>Configure</strong> — Select ROS distro (Humble = base + simulation; Jazzy = base only), robot, middleware, engine, and base preset. Unsupported controls are greyed out with a short explanation. Save persists to Preferences.
        </div>
        <div>
          <strong>Phase 1: Base Image</strong> — Builds tools on top of a digest-pinned upstream. Humble presets: <span class="font-mono">sloretz</span> (multi-arch, tag <span class="font-mono">:sloretz</span>) or <span class="font-mono">osrf</span> (amd64, tag <span class="font-mono">:osrf</span>). Jazzy uses official <span class="font-mono">ros:jazzy-ros-base</span> (tag <span class="font-mono">:latest</span>).
        </div>
        <div>
          <strong>Phase 2: Simulation Image</strong> — Humble only today (Gazebo, Nav2, TurtleBot3), layered <span class="font-mono">FROM</span> your Phase 1 local base. Disabled until the base image exists locally.
        </div>
        <div>
          <strong>Cancel / Push</strong> — Cancel aborts an in-progress build. Push requires registry login via Podman Desktop &rarr; Settings &rarr; Registries.
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
        <p class="font-mono text-xs">quay.io/&lt;ns&gt;/ros2-humble-turtlebot3:sloretz</p>
      </div>
    </div>

    <div class="rounded-lg border border-[var(--pd-content-card-border)] bg-[var(--pd-content-card-bg)] p-4">
      <h2 class="text-lg font-medium text-[var(--pd-content-header)] mb-2">Tips</h2>
      <div class="text-sm text-[var(--pd-content-text)] flex flex-col gap-1">
        <p>&#8226; Arch warnings appear only when the selected preset does not support your host architecture.</p>
        <p>&#8226; Pull progress may jump as layers are discovered — that is normal.</p>
        <p>&#8226; The extension remembers your last visited page.</p>
      </div>
    </div>

    <div class="rounded-lg border border-[var(--pd-content-card-border)] bg-[var(--pd-content-card-bg)] p-4">
      <h2 class="text-lg font-medium text-[var(--pd-content-header)] mb-2">Coming Soon</h2>
      <div class="text-sm text-[var(--pd-content-text)] flex flex-col gap-1">
        <p><strong>Simulation</strong> — One-click launch of ROS2 + Gazebo with browser-based visualization (Story 2).</p>
        <p><strong>Additional robots</strong> — Beyond TurtleBot3 (planned; see project plan).</p>
        <p><strong>Fleet</strong> — Multi-robot local fleets with Zenoh.</p>
        <p><strong>OpenShift Bridge</strong> — Export to Kubernetes / OpenShift.</p>
      </div>
    </div>

  </div>
</div>
