<script lang="ts">
import { router } from 'tinro';
</script>

<div class="flex flex-col p-4 gap-4 h-full overflow-auto">
  <button on:click={() => router.goto('/')} class="pai-link self-start"> &larr; Back to Dashboard </button>
  <h1 class="text-3xl text-[var(--pd-content-header)]">Help</h1>
  <p class="text-sm text-[var(--pd-content-text)]">
    Quick guide to using the Physical AI extension for Podman Desktop.
  </p>

  <div class="flex flex-col gap-4">
    <div class="rounded-lg border border-[var(--pd-content-card-border)] bg-[var(--pd-content-card-bg)] p-4">
      <h2 class="text-lg font-medium text-[var(--pd-content-header)] mb-2">Getting Started</h2>
      <div class="text-sm text-[var(--pd-content-text)] flex flex-col gap-1">
        <p>
          Physical AI gives robotics developers a GUI-driven path from local development to OpenShift deployment — no
          terminal required.
        </p>
        <p>
          Typical demo path:
          <strong>Image Builder</strong> (build base + sim) →
          <strong>Simulation</strong> (launch empty Gazebo + noVNC) →
          <strong>Add TurtleBot3</strong>. Or pull golden images from <strong>Image Catalog</strong>. Bases are
          <strong>Ubuntu interim</strong> today; Fedora/RHEL migration is tracked separately.
        </p>
      </div>
    </div>

    <div class="rounded-lg border border-[var(--pd-content-card-border)] bg-[var(--pd-content-card-bg)] p-4">
      <h2 class="text-lg font-medium text-[var(--pd-content-header)] mb-2">Image Catalog</h2>
      <div class="text-sm text-[var(--pd-content-text)] flex flex-col gap-2">
        <div>
          <strong>Browse repositories</strong> — Enter a Quay.io namespace and click Load. Expand any repository to see tags
          with size, date, and digest.
        </div>
        <div>
          <strong>All vs Curated</strong> — Default view is <strong>All</strong> (every <strong>public</strong> repo in
          the namespace; private Quay repos are not listed without auth). Switch to <strong>Curated</strong> to show
          only names matching the allowlist (default
          <span class="font-mono">ros2-*-base,ros2-*-turtlebot3,ros2-*-sim*</span>). Both the default view and the
          allowlist are configurable under Settings &rarr; Preferences &rarr; Physical AI (comma-separated patterns;
          <span class="font-mono">*</span> is a wildcard).
        </div>
        <div>
          <strong>Filter</strong> — Use "Filter by name" to further narrow the list.
        </div>
        <div>
          <strong>Pull images</strong> — Click Pull on any tag. Progress shows aggregated layer download status.
        </div>
        <div>
          <strong>Locally Available</strong> — Collapsible section lists images from this namespace already present
          locally. The backend merges the Podman Desktop image list with <span class="font-mono">podman images</span> so untagged
          or oddly-tagged local images still appear.
        </div>
      </div>
    </div>

    <div class="rounded-lg border border-[var(--pd-content-card-border)] bg-[var(--pd-content-card-bg)] p-4">
      <h2 class="text-lg font-medium text-[var(--pd-content-header)] mb-2">Image Builder</h2>
      <div class="text-sm text-[var(--pd-content-text)] flex flex-col gap-2">
        <div>
          <strong>Quick Start</strong> — two presets that set the dropdowns, save preferences, and scroll to Phase 1,
          then you click Build for Phase 1 and Phase 2. <strong>Local</strong> (<span class="font-mono"
            >TurtleBot3 Sim (Jazzy)</span
          >) builds natively for your host to run locally. <strong>OpenShift</strong> (<span class="font-mono"
            >TurtleBot3 Sim (Jazzy &middot; amd64)</span
          >) targets <span class="font-mono">amd64</span> so the images are pullable by an OpenShift cluster (on an Apple
          Silicon host this cross-builds via emulation and is slower — expected).
        </div>
        <div>
          <strong>Configure</strong> — Select ROS distro (Humble or Jazzy), robot, middleware, engine, and base preset. Save
          persists to Preferences.
        </div>
        <div>
          <strong>Phase 1: Base Image</strong> — Humble: <span class="font-mono">sloretz</span> (<span class="font-mono"
            >:sloretz</span
          >) or <span class="font-mono">osrf</span> (<span class="font-mono">:osrf</span>). Jazzy: Ubuntu Noble preset
          (tag <span class="font-mono">:noble</span>). Official Jazzy amd64 preset uses tag
          <span class="font-mono">:latest</span>.
        </div>
        <div>
          <strong>Phase 2: Simulation Image</strong> — Layers Gazebo, TurtleBot3 spawn assets, and noVNC (Jazzy) on your Phase
          1 local base. Nav2 packages are included; on Jazzy sim, **Navigate** launches Nav2 for obstacle-aware navigation.
          Disabled until the base exists locally.
        </div>
        <div>
          <strong>Cancel / Push</strong> — Cancel aborts an in-progress <strong>build</strong> or <strong>push</strong>.
          Push requires registry login via Podman Desktop &rarr; Settings &rarr; Registries. Image Builder also shows
          whether the current <span class="font-mono">quay.io/…</span> tag exists on Quay (public repos only; private repos
          show as unavailable).
        </div>
      </div>
    </div>

    <div class="rounded-lg border border-[var(--pd-content-card-border)] bg-[var(--pd-content-card-bg)] p-4">
      <h2 class="text-lg font-medium text-[var(--pd-content-header)] mb-2">Simulation</h2>
      <div class="text-sm text-[var(--pd-content-text)] flex flex-col gap-2">
        <div>
          <strong>Launch</strong> — Pick a local sim image (tags matching <span class="font-mono">ros2-*-sim*</span> or
          <span class="font-mono">ros2-*-turtlebot3</span>). The container starts Gazebo + noVNC. The world is
          <strong>empty</strong> until you add a robot.
        </div>
        <div>
          <strong>Image trust</strong> — Launch runs entrypoints from the selected <em>local</em> image. Tag matching is
          not a signature check: only use images you built via Image Builder or pulled from a Quay namespace you trust.
          For demos, pin exact tags or digests under Settings → Preferences → Physical AI →
          <span class="font-mono">Simulation image allowlist</span>.
        </div>
        <div>
          <strong>Stop &amp; remove</strong> — Stops and deletes the simulation container in one step. A notification reminds
          you to close the Gazebo (noVNC) browser tab (the extension cannot close it).
        </div>
        <div>
          <strong>Open in Browser</strong> — Opens noVNC at <span class="font-mono">/vnc.html</span> with autoconnect +
          auto-reconnect (port <span class="font-mono">6080</span>), or the landing page (<span class="font-mono"
            >8080</span
          >). Other ports are rejected by the API. Idle background tabs often drop the WebSocket (“Disconnected”);
          reconnect or a refresh brings the view back — the sim is still running.
        </div>
        <div>
          <strong>Add TurtleBot3</strong> — Spawns a robot into the running world via
          <span class="font-mono">podman exec</span> (name + X/Y/yaw).
        </div>
        <div>
          <strong>Navigate</strong> — Each spawned robot has a <strong>Navigate</strong> button with target X/Y
          coordinates (map frame). On Jazzy sim images, the extension launches Nav2 if needed and sends a
          <span class="font-mono">navigate_to_pose</span>
          goal with lidar-based obstacle avoidance. Status shows: Navigating &rarr; Reached (X, Y) / Failed. Humble images
          still use open-loop <span class="font-mono">cmd_vel</span> (turn + drive, no obstacle avoidance). Run one simulation
          at a time when navigating (default ROS domain is shared across containers).
        </div>
      </div>
    </div>

    <div class="rounded-lg border border-[var(--pd-content-card-border)] bg-[var(--pd-content-card-bg)] p-4">
      <h2 class="text-lg font-medium text-[var(--pd-content-header)] mb-2">Topic Monitor</h2>
      <div class="text-sm text-[var(--pd-content-text)] flex flex-col gap-2">
        <div>
          <strong>Overview</strong> — Shows active ROS2 topics inside a running simulation container, including message types
          and publisher/subscriber counts. Auto-refreshes every 5 seconds.
        </div>
        <div>
          <strong>Access</strong> — Dashboard card, or <strong>View Topics</strong> button on a running simulation container
          card on the Simulation page.
        </div>
        <div>
          <strong>How it works</strong> — Runs <span class="font-mono">ros2 topic list</span> and
          <span class="font-mono">ros2 topic info</span>
          via <span class="font-mono">podman exec</span> inside the container. No additional setup needed.
        </div>
        <div>
          <strong>Drill-down</strong> — Click a topic row to expand publishers and subscribers (<span class="font-mono"
            >ros2 topic info -v</span
          >).
        </div>
        <div>
          <strong>Peek</strong> — On an expanded row, <strong>Peek</strong> captures one live message (<span
            class="font-mono">ros2 topic echo --once</span
          >). Timeout is configurable under Preferences → Physical AI → <strong>Topic peek timeout</strong> (1–30
          seconds, default 5). Shows topic/type, wall-clock capture time, optional ROS msg stamp, and a Tree/Raw view
          with Copy. Idle topics show a timeout notice. Message schema is available via
          <strong>Show message schema</strong> (<span class="font-mono">ros2 interface show</span>). Msg stamp is time
          inside the message (e.g. <span class="font-mono">header.stamp</span>), not the
          <span class="font-mono">/clock</span> topic.
        </div>
      </div>
    </div>

    <div class="rounded-lg border border-[var(--pd-content-card-border)] bg-[var(--pd-content-card-bg)] p-4">
      <h2 class="text-lg font-medium text-[var(--pd-content-header)] mb-2">Golden Quay images</h2>
      <div class="text-sm text-[var(--pd-content-text)] flex flex-col gap-1">
        <p>
          Recommended set to publish for Catalog demos (replace <span class="font-mono">&lt;ns&gt;</span> with your namespace):
        </p>
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
        <p>
          &#8226; On Apple Silicon, simulation launch passes <span class="font-mono">/dev/dri</span> by default
          (virtio-gpu). Disable <strong>Simulation GPU passthrough</strong> in Preferences to force software rendering.
        </p>
        <p>
          &#8226; noVNC may show Disconnected after an idle background tab — auto-reconnect or refresh; the sim is still
          running.
        </p>
        <p>
          &#8226; After <strong>Stop &amp; remove</strong>, close the Gazebo browser tab yourself (the extension cannot
          close it).
        </p>
        <p>
          &#8226; Demo flow: Image Builder → Launch → Open in Browser → Add TurtleBot3 → Navigate → Topics → Stop &amp;
          remove.
        </p>
      </div>
    </div>

    <div class="rounded-lg border border-[var(--pd-content-card-border)] bg-[var(--pd-content-card-bg)] p-4">
      <h2 class="text-lg font-medium text-[var(--pd-content-header)] mb-2">Coming Soon</h2>
      <div class="text-sm text-[var(--pd-content-text)] flex flex-col gap-1">
        <p><strong>Customize hardware</strong> — Swap sensors (e.g. camera) on a running robot.</p>
        <p><strong>Additional robots</strong> — Beyond TurtleBot3.</p>
        <p><strong>Fleet</strong> — Multi-robot local fleets with Zenoh.</p>
        <p><strong>OpenShift Bridge</strong> — Export to Kubernetes / OpenShift.</p>
      </div>
    </div>
  </div>
</div>
