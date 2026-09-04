<script lang="ts">
import { router } from 'tinro';
import { navigationLayout } from './lib/navigationLayout';
</script>

<div class="flex flex-col p-4 gap-4 h-full overflow-auto">
  {#if $navigationLayout === 'cards'}
    <button on:click={() => router.goto('/')} class="pai-link self-start"> &larr; Back to Dashboard </button>
  {/if}
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
          <strong>Configure</strong> — Select ROS distro (Humble or Jazzy), robot, middleware, engine, and base preset.
          Save persists to Preferences. Humble is <strong>not currently verified working</strong> — use Jazzy.
        </div>
        <div>
          <strong>Phase 1: Base Image</strong> — Humble: <span class="font-mono">sloretz</span> (<span class="font-mono"
            >:sloretz</span
          >) or <span class="font-mono">osrf</span> (<span class="font-mono">:osrf</span>). Jazzy: Ubuntu Noble preset
          (tag <span class="font-mono">:noble</span>). Official Jazzy amd64 preset uses tag
          <span class="font-mono">:latest</span>.
        </div>
        <div>
          <strong>Phase 2: Simulation Image</strong> — Layers Gazebo, TurtleBot3 spawn assets, and noVNC (Jazzy) on your
          Phase 1 local base. Nav2 packages are included; on Jazzy sim, <strong>Navigate</strong> launches Nav2 for obstacle-aware
          navigation. Disabled until the base exists locally.
        </div>
        <div>
          <strong>Cancel / Push</strong> — Cancel aborts an in-progress <strong>build</strong> or <strong>push</strong>.
          Push requires registry login via Podman Desktop &rarr; Settings &rarr; Registries. Image Builder also shows
          whether the current <span class="font-mono">quay.io/…</span> tag exists on Quay (public repos only; private repos
          show as unavailable).
        </div>
        <div>
          <strong>Layers layout</strong> — Compose an image from Base OS, hardened app, ROS, and simulation layers, with
          a live compatibility verdict as you pick. Pull the layer images (base OS + any selected Hummingbird images)
          right from the wizard — a <span class="font-mono">&#10003; Local</span> badge marks the ones you already have
          — then build the composed image: a tested Ubuntu + ROS [+ Sim] stack builds the full runnable image, and any
          other combination builds from the generated Containerfile (an <em>Attempt anyway</em> build of a blocked
          combination really runs and fails at the step the verdict names). The bootc bases and Hummingbird hardened
          apps shown are a representative catalog; install the <span class="font-mono">redhat.bootc</span> and
          <span class="font-mono">redhat.hummingbird</span> extensions to pull those images. Hummingbird apps split into
          <em>companions</em> (pulled and run alongside) and <em>tools</em> (a hardened CLI baked in via
          <span class="font-mono">COPY --from</span>).
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
          <strong>Show Viewer</strong> — Embeds the same noVNC canvas inline in the panel instead of opening a browser
          tab — click again (<strong>Hide Viewer</strong>) to collapse it. No separate reconnect step; it collapses
          automatically if the container stops.
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
        <div>
          <strong>Nav2 warming</strong> — After you spawn a robot on a Jazzy image, the extension starts Nav2 in the
          background so the first <strong>Navigate</strong> is not starting from a cold stop. While warming you see
          <strong>Nav2 warming&hellip;</strong> and the target/Navigate controls stay hidden; once Nav2 is ready the
          controls appear. Warming is best-effort (if it fails, <strong>Navigate</strong> can still cold-start Nav2, just
          slower).
        </div>
        <div>
          <strong>Why nothing moves for ~15&ndash;20&nbsp;s after Navigate</strong> — On the <em>first</em> navigation after
          spawn (or after Nav2 was not running), the stack must finish coming up and the global costmap must settle. The extension
          clears stale obstacle cells from that startup window before planning. Until a valid path exists, Nav2 retries internally
          and the robot stays put &mdash; this is normal, not a hang. The second Navigate on the same robot is usually much
          quicker.
        </div>
        <div>
          <strong>Why the robot &ldquo;hops&rdquo; or sits in one spot for a minute or more</strong> — Two common
          causes: (1)&nbsp;<strong>Not enough CPU</strong> for the workload &mdash; Gazebo (especially the noVNC GUI),
          physics, and Nav2 all compete for the pod&rsquo;s CPU quota. When the cluster throttles the pod, simulation
          time runs slower than real time, so motion looks frozen or stuttery even though Nav2 is working. On OpenShift
          GPU nodes (<span class="font-mono">g5.2xlarge</span>), request <strong>6&ndash;7</strong> guaranteed CPUs for
          the sim container (7 without the Hummingbird sidecar, 6 with it); values like 3 are too low and match the
          slow/hoppy behavior. Software-render (no GPU) deployments usually need <strong>8</strong> (adjust via
          <strong>Guaranteed CPUs</strong>). (2)&nbsp;<strong>Nav2 recovery</strong> &mdash; if the planner cannot find a
          path yet, the behavior tree runs recovery moves (spin, backup, clear costmap) that can look like hopping in place
          before forward motion starts.
        </div>
      </div>
    </div>

    <div class="rounded-lg border border-[var(--pd-content-card-border)] bg-[var(--pd-content-card-bg)] p-4">
      <h2 class="text-lg font-medium text-[var(--pd-content-header)] mb-2">OpenShift Deployment</h2>
      <div class="text-sm text-[var(--pd-content-text)] flex flex-col gap-2">
        <div>
          <strong>Deploy</strong> — On the Simulation page's <strong>OpenShift</strong> tab, pick a pushed
          <span class="font-mono">amd64</span>
          image, a namespace/context (seeded from your current kubeconfig), and a name, then
          <strong>Preview manifests</strong>
          and <strong>Deploy</strong>. Once the route is ready, <strong>Open URL</strong> launches noVNC in a browser
          tab, or <strong>Show Viewer</strong> embeds it inline in the panel instead — same as local Simulation, over the
          cluster's route.
        </div>
        <div>
          <strong>Manage</strong> — Deployed sims are listed with delete/refresh and per-robot spawn/navigate/remove, same
          as the local Simulation page.
        </div>
        <div>
          <strong>Cluster has a GPU</strong> — Toggle for NVIDIA GPU Operator clusters: requests
          <span class="font-mono">nvidia.com/gpu</span> and uses hardware rendering for the noVNC GUI (VirtualGL).
          Sensor rendering stays on software EGL to avoid a known long-run GPU driver issue. You still need enough CPU
          for the GUI, physics, and Nav2 &mdash; see <strong>Guaranteed CPUs</strong> below.
        </div>
        <div>
          <strong>Guaranteed CPUs (sim container)</strong> — Sets guaranteed CPU for the sim container (1&ndash;64;
          requests&nbsp;==&nbsp;limits). The whole pod (sim&nbsp;+&nbsp;optional Hummingbird sidecar) must fit on one
          node.
          <strong>Software-render (GPU off):</strong> default <strong>8</strong>; dial to your worker node sizes.
          <strong>GPU on a <span class="font-mono">g5.2xlarge</span> node:</strong> use <strong>7</strong> without the
          Hummingbird sidecar, or <strong>6</strong> with it &mdash; that is the practical maximum on an 8&nbsp;vCPU GPU node
          after system overhead (~7.5&nbsp;cores allocatable). Lower values schedule but navigation becomes slow or jerky
          (simulation runs below real-time). The UI allows up to 64; the scheduler will keep the pod Pending if the request
          exceeds what the node can fit.
        </div>
        <div>
          <strong>Hummingbird nginx sidecar</strong> — Optional checkbox that adds a
          <span class="font-mono">registry.access.redhat.com/hi/nginx</span> companion container to the pod, reverse-proxying
          noVNC through it, to demonstrate the Hummingbird companion-image pattern live.
        </div>
      </div>
    </div>

    <div class="rounded-lg border border-[var(--pd-content-card-border)] bg-[var(--pd-content-card-bg)] p-4">
      <h2 class="text-lg font-medium text-[var(--pd-content-header)] mb-2">Diagnostics</h2>
      <div class="text-sm text-[var(--pd-content-text)] flex flex-col gap-2">
        <div>
          <strong>Overview</strong> — A health-check panel for a selected spawned robot (local or OpenShift): TF tree status,
          costmap topic, and laser/lidar topic — useful for confirming Nav2 is actually ready before you hit Navigate.
        </div>
        <div>
          <strong>Access</strong> — Click <strong>Diagnose</strong> next to a spawned robot on the Simulation or OpenShift
          page, or open the Diagnostics page directly and pick a target/robot.
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
          Recommended set to publish for Catalog demos (replace <span class="font-mono">&lt;ns&gt;</span> with your namespace).
        </p>
        <p class="font-mono text-xs">quay.io/&lt;ns&gt;/ros2-jazzy-base:latest</p>
        <p class="font-mono text-xs">quay.io/&lt;ns&gt;/ros2-jazzy-base:noble</p>
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
          &#8226; Demo flow: Image Builder → Launch → Show Viewer → Add TurtleBot3 → Navigate → Topics → Stop &amp;
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
        <p>
          <strong>Humble support</strong> — exists in the codebase but is not currently verified working; needs re-validation.
        </p>
      </div>
    </div>
  </div>
</div>
