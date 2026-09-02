# Story 10 — Post-ROSCon Product Backlog

> **Jira:** several items are now filed (see the [tracking table](#tracking) for the
> authoritative live status of every item) — this doc started 2026-09-01 as analysis/
> categorization only with no tickets filed, but items get sub-tasked and Closed over time as
> they're picked up.
>
> **Scope:** explicitly *not* about the ROSCon MVP demo path — these are features, fixes, and
> polish aimed at making the extension a real, complete product beyond the demo. Deliberately
> broader than "UX" — several items (Topics-from-OpenShift, per-layer SBOM attribution, the
> streaming viewer) are genuinely new capabilities, not visual polish.
>
> **Status:** ongoing — a mix of pure-exploration items and some already Closed. Items are
> numbered `S10-N`. This doc exists so every raw item from the original list is visible in one
> place — the next step for each is a separate decision (new sub-task under an existing Story, a
> direct small fix, or its own new doc); as that happens, update the [tracking table](#tracking)
> to say where it moved.

<a id="whats-next"></a>

## What's next (priority snapshot, 2026-09-02)

A point-in-time read of what's most worth picking up next, across Story 9 and Story 10 combined
— re-derive from the [tracking table](#tracking) and Story 9's Jira-status line if this snapshot
is more than a couple weeks old, don't trust it blindly.

1. **S10-1/S10-2 (noVNC embedded viewer)** — pulled forward. Filed as
   [APPENG-6283](https://redhat.atlassian.net/browse/APPENG-6283) under new Story
   [APPENG-6282](https://redhat.atlassian.net/browse/APPENG-6282); worktree set up. Starts with a
   spike: CSP/iframe feasibility for Option A, or whether Podman Desktop's current extension API
   exposes a container-Details-tab contribution point at all for Option B.
2. **S10-7 (Dashboard OpenShift sim count)** — small, well-scoped gap left over from the
   APPENG-6256 batch (S10-8 shipped without it); easy pickup.
3. **S10-11 follow-up (CLI menu-driven help)** — small, now that S9-4/APPENG-6236 shipped
   without it.
4. **APPENG-6263 (S10-15 registry audit)** and **APPENG-6264 (S10-16 syft/cosign showcase)** —
   already filed under APPENG-6225, no worktree started yet.
5. **S9-7/APPENG-6237** (config-driven robot definition) and **S9-1/APPENG-6238** (`oc` → library)
   — already filed in Story 9, genuinely not started (see
   [story9-platform-exploration.md](story9-platform-exploration.md)).
6. **Idle pre-existing spikes** — `APPENG-5809-fedora-quadlet-spike`, `APPENG-6070-multipod-zenoh`,
   `APPENG-6071-humble-parity` worktrees — untouched, still there whenever picked up.
7. **Larger/lower-readiness backlog** — S10-3/S10-4 (SBOM layer viz), S10-6 (Topic Monitor
   OpenShift), S10-12 (telemetry), S10-13 (hybrid topology) — all still research/spike-only, no
   ticket yet.

## Table of Contents

- [What's next (priority snapshot)](#whats-next)
- [Method](#method)
- [S10-1 — noVNC embedded in the extension (Phase 1)](#s10-1)
- [S10-2 — Custom streaming-video simulation viewer (Phase 2)](#s10-2)
- [S10-3 — SBOM layer/slice attribution and visualization](#s10-3)
- [S10-4 — Per-slice incremental rebuild UX](#s10-4)
- [S10-5 — OpenShift tab: pick from already-pushed images](#s10-5)
- [S10-6 — Topic Monitor support for OpenShift simulations](#s10-6)
- [S10-7 — Dashboard: OpenShift simulation count metric](#s10-7)
- [S10-8 — Dashboard: clickable metric tiles](#s10-8)
- [S10-9 — BUG: Get Started "Navigate" button goes to the wrong page](#s10-9)
- [S10-10 — Image Builder: auto-collapse base-image logs on Phase 2 build](#s10-10)
- [S10-11 — CLI: menu-driven help with no arguments (folds into S9-4)](#s10-11)
- [S10-12 — Telemetry & richer metrics (OTEL / Prometheus)](#s10-12)
- [S10-13 — Hybrid topology: local robot + in-cluster simulation & inference](#s10-13)
- [S10-14 — Local Hummingbird nginx sidecar (Podman multi-container)](#s10-14)
- [S10-15 — Hummingbird registry-path audit (quay.io → registry.access.redhat.com)](#s10-15)
- [S10-16 — Hummingbird showcase: syft external-scan pattern + cosign bundled-tool demo](#s10-16)
- [Tracking: where each item currently lives](#tracking)

## Method

Same approach as Story 9: research each item against the actual codebase before writing
anything down, not guesses. Two items below were resolved by reading code directly rather
than asked as questions (S10-3's layer-attribution mechanism, S10-6's current OpenShift
support), and two genuine implementation-approach ambiguities were resolved with the user
directly (S10-1's embed target, S10-3's "layers" meaning) before writing this doc.

---

<a id="s10-1"></a>

## S10-1 — noVNC embedded in the extension (Phase 1)

**Ask:** display the running simulation's noVNC output inside the extension itself, not by
opening a separate browser tab.

**Findings:** the simulation already exposes noVNC at a known host-mapped port
(`hostPortForPrivate` in `LocalSimulation.svelte`, and the OpenShift Route for the
in-cluster case) — the extension already knows this URL, it's just currently only offered as
an "open in browser" action. Embedding the same URL in an iframe on a new route is
mechanically small; the main unknowns are Podman Desktop webview CSP/iframe restrictions
(needs a real spike, not just a code read) and behavior when the sim isn't running yet or the
route isn't admitted (already partially handled for the "open in browser" case, needs the
same treatment inline).

**Where to render it — reopened for deeper investigation (2026-09-02):** an initial pass
(2026-09-01) picked "our own extension's webview" and explicitly dropped Podman Desktop's
native container Details tab, to avoid depending on an uncertain PD contribution surface.
Given S10-1 is now being considered for earlier priority as a **major showcase asset** (see
Priority note below), that tradeoff is worth re-examining properly rather than assuming the
2026-09-01 pass had full information — both options below stay open; whoever picks up this
item should spike the unknowns before committing:

- **Option A — our own extension's webview/route.** A new page/route in the Physical AI
  extension with an iframe (or equivalent embed) pointing at the noVNC URL.
  - *Pros:* fully under our control; no dependency on Podman Desktop's own extension-API
    surface for container details; sets up naturally for the Phase 2 custom streaming viewer
    (S10-2), which will need to live somewhere we control anyway.
  - *Cons:* still needs the CSP/iframe spike; it's "yet another page" the user has to navigate
    to, one level removed from where they're already looking at the running container in PD.
- **Option B — a contribution to Podman Desktop's own container Details tab (the original
  "podman tab" phrasing).** The user is already looking at the sim container in PD's own
  container list/details view — showing the live noVNC output right there, without switching
  to our extension's pages, would be a more integrated experience and a stronger demo of deep
  Podman Desktop extension-API integration than an ordinary in-extension route.
  - *Pros:* more natural/discoverable placement (no extra navigation); if genuinely supported,
    it's a differentiated, PD-native showcase — arguably a bigger "wow" moment for ROSCon-style
    demos than a page inside our own extension.
  - *Cons:* depends entirely on whatever UI-contribution points the `@podman-desktop/api`
    version we depend on does or doesn't currently expose for the container Details view — this
    was flagged as an "uncertain/unstable surface" in the original pass and was **never actually
    verified against the current API**, only assumed risky. The real unknown is a live check of
    the current `@podman-desktop/api` types/docs for a container-details-tab contribution point,
    not a re-litigation of the tradeoff itself.

**Effort:** small–medium for Option A (mostly a spike to confirm the iframe isn't blocked by
CSP, then a new route + existing URL-resolution logic reused). Option B's effort is unknown
until the contribution-point spike above happens — could be comparable, or could be a dead end
if PD doesn't expose the needed surface today.

**Value:** meaningfully reduces friction (a robotics engineer testing a sim now never leaves
the extension, or never leaves PD's own container view) — a real product-completeness item,
not just cosmetic. See the priority note below for why this may be worth pulling forward.

**Priority note (2026-09-02):** flagged as a candidate to move earlier in the backlog — a
working embedded sim viewer (whichever option wins the spike) is a strong, visible showcase
asset for demoing the extension, not just an incremental UX nicety.

**Spike result (2026-09-02): Option B ruled out, Option A chosen.** Checked the installed
`@podman-desktop/api` types (`node_modules/@podman-desktop/api/src/extension-api.d.ts`,
version `1.28.3`, declared in `packages/backend/package.json`) directly, plus current Podman
Desktop docs/GitHub — confirmed live, not assumed. The only container-related contribution
surfaces are context-menu items (`contributes.menus` with a `container/...` context, same
pattern as pods/images/volumes) and `window.createWebviewPanel` (a brand-new panel in PD's own
nav, like the extension-template-full "Hello World" tab) — neither lets an extension inject
content into PD's existing container Details view. There is no
`contributes.containerDetails`-style tab-panel contribution point in this API version. Option A
it is.

Within Option A, a further placement question came up: a new dedicated route/page (as
literally described above) vs. embedding inline in the existing Local/OpenShift simulation
panel where "Open in Browser" already lives. Decision (user, 2026-09-02): start with the inline
panel — no extra navigation, and it can be revisited later if a dedicated page turns out to be
better.

**Status:** implemented under [APPENG-6283](https://redhat.atlassian.net/browse/APPENG-6283)
(Story [APPENG-6282](https://redhat.atlassian.net/browse/APPENG-6282), which also tracks S10-2
as a not-yet-sized follow-on). A "Show Viewer" toggle next to "Open in Browser"
(`LocalSimulation.svelte`) / "Open {route}" (`OpenShiftSimulation.svelte`) reveals an inline
`<iframe>` reusing the existing URL-resolution logic (`simulationBrowserUrl` for local,
`w.routeUrl` for OpenShift) and the existing running/ready-and-admitted gating — no new
not-running state needed. **Live-tested 2026-09-02, both paths:** the CSP/iframe question is
resolved — Podman Desktop's webview does not block the embedded noVNC iframe. Confirmed via
screenshot for both the local/Podman path (Gazebo Sim canvas + scene tree + spawned robot
rendering inline) and the OpenShift Route path (same, over the cluster's HTTPS route, robot
spawn/navigate UI working alongside it). Fully validated.

---

<a id="s10-2"></a>

## S10-2 — Custom streaming-video simulation viewer (Phase 2)

**Ask:** "develop our own app" to display the sim, and separately, a note about "streaming
video instead of frames — much faster/smaller."

**Reading (flagged to the user, not yet independently confirmed):** these are treated as the
same direction — Phase 2 is a custom viewer built around actual video-codec streaming (e.g.
WebRTC), replacing noVNC's VNC/RFB framebuffer-diffing protocol entirely, rather than a
custom client that still speaks VNC. If that's wrong — if "our own app" was meant as a
VNC-protocol-compatible custom client, independent of the streaming idea — this item splits
into two.

**Findings:** this is a real, known pattern (WebRTC video streaming of a rendered 3D scene is
standard for cloud-rendering products), but it's a materially bigger lift than S10-1: it
needs a streaming pipeline from Gazebo's rendered output (likely via a GStreamer or similar
encode step added to `entrypoint-gazebo.sh`'s existing X11/Xvfb pipeline) to a WebRTC
signaling+transport layer, plus a custom player in the frontend. No existing code in this
repo does anything like this today — this is genuinely new infrastructure, not a UI feature.

**Effort:** large — a multi-week spike at minimum before it's even clear this is worth
building versus just embedding noVNC (S10-1) well.

**Recommendation:** sequence strictly after S10-1 ships and is validated live; treat as a
spike/research item, not a committed build, until S10-1's embedding proves the simpler path
isn't good enough.

**Status:** tracked under Story [APPENG-6282](https://redhat.atlassian.net/browse/APPENG-6282)
(alongside S10-1) — not yet sized or filed as its own sub-task.

---

<a id="s10-3"></a>

## S10-3 — SBOM layer/slice attribution and visualization

**Ask (5 sub-asks from the original list, all one underlying feature):**
1. Group the SBOM's components instead of a flat list
2. Show "layers" instead of raw JSON text
3. Visualize different layers/slices
4. Show each slice's contents
5. Inspect a built image's layers/slices

**Clarified scope (2026-09-01):** "layers/slices" means **our own composition layers** from
the Layers wizard (Base OS / Hardened / ROS / Sim) — not raw OCI image layers.

**Findings:** this is a real, non-trivial feature, not a display tweak. syft's SBOM has no
awareness of our wizard's layer concept — a single scan of the finished image can't tell you
"the ROS layer added these 40 packages." Getting that requires **scanning between build
stages**: run syft after each layer's instructions complete (Base, then +Hardened, then +ROS,
then +Sim), and diff each scan against the previous one — the delta is what that layer
contributed. This means either (a) building each layer as its own intermediate tagged image
and scanning each, or (b) using multi-stage build target flags to stop the build at each
layer boundary and scan the intermediate result. Either way, this multiplies the number of
syft invocations per build (one per layer instead of one at the end) and needs its own UI
(a per-layer breakdown, likely an accordion/tree keyed by layer, each showing its own
component list — reusing the pretty-print/copy patterns already built for APPENG-6226's
single-SBOM view).

**Effort:** medium–large. The per-layer scan-and-diff mechanism is the hard part; the display
layer can mostly reuse APPENG-6226's existing SBOM UI patterns (format picker, pretty-print,
copy-to-clipboard) once the data is shaped per-layer instead of flat.

**Value:** strong, on-brand for the Hummingbird partnership narrative (S9-3's "real
supply-chain visibility" framing, taken further) — "see exactly what each layer of your image
contributes" is a compelling, differentiated demo.

---

<a id="s10-4"></a>

## S10-4 — Per-slice incremental rebuild UX

**Ask:** updating one slice (e.g. just the Sim layer) shouldn't require rebuilding the whole
multi-GB image.

**Findings (verified in code, not assumed):** `generateLayerContainerfile` in
`layerCompatibility.ts` already emits each layer as its own distinct Containerfile
instruction — Layer 1 `FROM`, Layer 2 Hummingbird `COPY`/`RUN`, a ROS-repo-setup `RUN`, Layer
3 ROS `RUN`, Layer 4 Sim `RUN`. Podman's build cache keys off instruction content and the
preceding layer's cache state, not the throwaway temp directory `buildFromContainerfile`
creates per build — so changing only the Sim selection and rebuilding should **already** hit
Podman's cache for Layers 1–3 today, with no new Containerfile engineering needed.

**What's actually missing:** visibility. The build UI doesn't currently show the user which
layers were cache-hits vs freshly rebuilt, so this benefit is invisible even though it likely
already works. Recommend: (1) first *verify* live that cache reuse actually behaves as
expected across separate `buildFromContainerfile` calls (a quick manual test, not a code
change), (2) if confirmed, surface it in the build log/UI (Podman's `buildImage` stream
events already include `"Using cache"`-style lines for cached steps — surface these
distinctly rather than folding them into the generic scrolling log).

**Effort:** small, once the caching behavior is confirmed to already work as expected.

**Value:** real, but smaller than the original ask implied — this is UX visibility for an
existing mechanism, not new build infrastructure.

---

<a id="s10-5"></a>

## S10-5 — OpenShift tab: pick from already-pushed images

**Ask:** the OpenShift deploy tab should list the same already-known local images (amd64,
pushed to quay.io) that Image Builder/Image Catalog already track, instead of requiring
manual tag entry.

**Findings:** `OpenShiftSimulation.svelte` already seeds a default image tag via
`simulationImageTag(ns, amd64Config)` on mount, but the field is a free-text input after
that — there's no picker/dropdown of other known-good images. `listLocalImages()` (already
used elsewhere, e.g. `LayerComposer.svelte`, `LocalSimulation.svelte`) is the existing API
that would back such a picker; filtering to amd64-tagged images matching the sim-image naming
convention is a filter on data the extension already fetches routinely.

**Effort:** small — mostly a dropdown/combobox wired to an existing API call, similar to
patterns already used elsewhere (e.g. the namespace-suggestion combobox in the same file).

**Value:** removes a real point of friction (remembering/copy-pasting a tag) in the OpenShift
deploy flow.

**Status:** filed as [APPENG-6259](https://redhat.atlassian.net/browse/APPENG-6259) under
APPENG-6256, merged
([f18e69e](https://github.com/sgahlot/podman-desktop-extension-robotics/commit/f18e69e)), Closed.

---

<a id="s10-6"></a>

## S10-6 — Topic Monitor support for OpenShift simulations

**Ask (two original bullets, same underlying gap):** "No link to Topics from OCP tab — do we
even allow topics being pulled from OCP simulations?" and, separately, "when viewing topics,
do we only look at local sim or OCP as well? ... same layout as Diagnostics/Simulation ->
Local/OpenShift, keeping data local to that tab."

**Findings (verified in code, not assumed): confirmed gap, not a missing link to an existing
capability.** `TopicMonitor.svelte`'s entire container list comes from
`listSimulationContainers()` (local podman only) — there's no OpenShift-pod code path
anywhere in the file. Topics literally cannot be viewed for an OpenShift-deployed simulation
today.

**Recommendation:** build it as a real Local/OpenShift tab split, explicitly mirroring the
pattern APPENG-5810 already established for Diagnostics (`split Diagnostics into Local/
OpenShift tabs`) — same shape: pick a namespace/workload on the OpenShift side, keep each
tab's data/polling scoped to itself. The backend already has the `oc exec`-based ROS command
infrastructure for OpenShift (used by Diagnostics/spawn/navigate) — Topics would reuse that
same execution path (`listRosTopics`/`getRosTopicDetail`/`peekRosTopic`-equivalent calls
targeting an OpenShift pod instead of a local container ID) rather than build anything new
from scratch.

**Effort:** medium — real new feature, but follows an established pattern (both the UI split
and the OpenShift-exec backend plumbing already exist elsewhere in the codebase to copy from).

**Value:** closes a genuine capability gap — OpenShift-deployed sims are otherwise a black
box for topic inspection today.

---

<a id="s10-7"></a>

## S10-7 — Dashboard: OpenShift simulation count metric

**Ask:** show a count of currently-deployed OpenShift simulations (current kube context)
under the Dashboard Overview, alongside whatever local metrics already exist — "or is that
too much?"

**Recommendation:** not too much — add it. `listOpenShiftDeployments(namespace, context)`
already exists and is exactly what this needs; the only design decision is whether to scope
by the configured default namespace or ask the user to pick one (recommend: default
namespace, consistent with how other OpenShift-aware parts of the extension already seed
from `getDefaultOpenShiftNamespace()`).

**Decision (2026-09-01):** don't fold OCP sims into a single blended count. Split the
simulations metric into **two sub-tiles — "N local" and "N OpenShift"** — under the Overview.
Both are **clickable** (see S10-8): the local sub-tile navigates to the Simulation page's
**Local** tab, and the OpenShift sub-tile to its **OpenShift** tab. This keeps the count
honest about where each sim runs and lands the user on the matching tab in one click.

**Effort:** small.

**Status (2026-09-02):** still open — not covered by S10-8's shipped work below. Verified in
code: `Dashboard.svelte` today has only the 2 original tiles (Local ROS 2 images, running
simulations), no "N OpenShift" sub-tile. Needs its own sub-task if still wanted.

---

<a id="s10-8"></a>

## S10-8 — Dashboard: clickable metric tiles

**Ask:** "Local ROS 2 images" and "N running simulations" tiles under Overview should
navigate to Image Catalog and Simulation respectively when clicked.

**Scope (2026-09-01), incorporating S10-7's split:** all Overview metric tiles are clickable —
- "Local ROS 2 images" → Image Catalog
- simulations → **two sub-tiles** (per S10-7): "N local" → Simulation page's **Local** tab,
  "N OpenShift" → its **OpenShift** tab

The OpenShift sub-tile is the new tile added by S10-7 and must be clickable like the rest — no
non-clickable metric tiles remain under Overview.

**Effort:** small — routing-only change, no new data needed.

**Status (2026-09-02):** filed as [APPENG-6257](https://redhat.atlassian.net/browse/APPENG-6257)
under APPENG-6256, merged
([455babe](https://github.com/sgahlot/podman-desktop-extension-robotics/commit/455babe)), Closed
— **but the shipped scope was narrower than planned above**: only the 2 pre-existing tiles
("Local ROS 2 images", running simulations) were made clickable. S10-7's new OpenShift sub-tile
was never added, so its "make it clickable too" half of this item didn't happen either. If S10-7
is picked up later, its sub-tile will need its own clickability wiring at that point.

---

<a id="s10-9"></a>

## S10-9 — BUG: Get Started "Navigate" button goes to the wrong page

**Ask:** clicking "Navigate" under Get Started should go to the Simulation page.

**Classification:** this reads as a **bug** (existing button, wrong/no destination), not a
net-new feature — flagged for confirmation before deciding its track (see tracking table).
Given its apparent small size, a plausible candidate for a direct small fix rather than a
full sub-task, once confirmed.

**Status:** filed as [APPENG-6260](https://redhat.atlassian.net/browse/APPENG-6260) under
APPENG-6256, merged
([dc52d2c](https://github.com/sgahlot/podman-desktop-extension-robotics/commit/dc52d2c)), Closed.

---

<a id="s10-10"></a>

## S10-10 — Image Builder: auto-collapse base-image logs on Phase 2 build

**Ask:** when the Phase 2 (Sim image) build starts, automatically collapse the already-done
Phase 1 (Base image) build logs panel.

**Findings:** `BuildPushPanel.svelte` (the shared component used by both Base and Sim build
panels) already has a `buildLogsExpanded` boolean per panel instance — this is purely a
"default the *other* instance's expanded state to false when this one starts building" wiring
change in the parent (`SimulationSetup.svelte`), not new state machinery.

**Effort:** small.

**Status:** filed as [APPENG-6258](https://redhat.atlassian.net/browse/APPENG-6258) under
APPENG-6256, merged
([a87b339](https://github.com/sgahlot/podman-desktop-extension-robotics/commit/a87b339)), Closed.

---

<a id="s10-11"></a>

## S10-11 — CLI: menu-driven help with no arguments (folds into S9-4)

**Ask:** running the future CLI with no arguments/options should show a menu of available
areas (Image Builder, Image Catalog, Simulation, Topics), not just a bare usage error.

**Classification:** **not independent net-new work** — the CLI itself doesn't exist yet
(Story 9's S9-4 is still "worth scoping," no implementation started). This is a design
requirement to carry into S9-4 when that item is actually picked up, not a separate Story 10
item. Recorded here only so it isn't lost, and cross-referenced back to
[story9-platform-exploration.md](story9-platform-exploration.md#s9-4).

**Status (2026-09-02): gap found.** S9-4/APPENG-6236 (`physical-ai-cli`) has since shipped and
Closed (merged 58a9045) — but this menu-driven no-args help was **not** part of that shipped
slice (build:base/sim/file, sim:open/list/remove, Listr2 task-list UI). The "carry into S9-4"
plan above didn't happen. This now needs its own follow-up ticket if still wanted, rather than
still being foldable into S9-4.

---

<a id="s10-12"></a>

## S10-12 — Telemetry & richer metrics (OTEL / Prometheus)

**Ask:** add support for telemetry and more metrics — OpenTelemetry, Prometheus, etc.

**Findings (verified in code, not assumed): there is no telemetry or metrics infrastructure
of any kind today.** What exists are one-shot, on-demand *textual* snapshots, not a metrics
pipeline:
- **Dashboard Overview** (`Dashboard.svelte`) has only two numeric tiles — local ROS 2 image
  count and running-sim count — derived from `listLocalImages()` / `listSimulationContainers()`.
- **Topic Monitor** (`TopicMonitor.svelte` + backend `listRosTopics`/`getRosTopicDetail`/
  `peekRosTopic`) lists topics with pub/sub counts via `ros2 topic list`/`info` over
  `podman exec`, auto-refreshing every 5s. Notably, **message-rate (Hz) measurement is
  explicitly deferred/unimplemented** (`docs/podman-extension-plan.md:184`).
- **Diagnostics** (`Diagnostics.svelte`, backend `getTfTreeStatus`/`getCostmapSummary`/
  `getLaserScanSummary` + `...InOpenShift` variants) produces textual TF/costmap/laser
  snapshots via `ros2 topic echo`/`tf2_echo`, plus Nav2 warm status.

There is **no** collection of: topic rates (Hz), node-health polling, Gazebo performance
(RTF/step time), or any container/pod resource usage (no `podman stats`, no cluster metrics).
Prometheus/Grafana appear **only as labels** in the Layer Composer's companion-image catalog
(`layerCompatibility.ts` — "Hardened Prometheus (fleet metrics)" etc.), i.e. images you can
bake in, not running infrastructure. `@opentelemetry/api` appears only as an unused *optional
peer-dep of vitest*, not a real dependency. Podman Desktop's own framework exposes
`extensionApi.env.createTelemetryLogger()` (usage/error logging) — **available but entirely
unused** here — and the cluster's Prometheus/monitoring stack is completely untapped (all
OpenShift access is `oc exec`/`oc get`, no monitoring/Thanos query API).

**Two distinct threads under one ask — worth separating when scoping:**
1. **Product/usage telemetry** (how the extension itself is used) — the natural fit is Podman
   Desktop's `createTelemetryLogger()` hook. Small-ish, but has privacy/opt-in implications
   that need a product decision before any events are emitted.
2. **Runtime robotics metrics** (topic Hz, node health, resource usage, Gazebo perf) exported
   in a scrapeable form (Prometheus `/metrics`) and/or via OTEL, with in-extension dashboards
   and/or handing off to the cluster's Prometheus + Grafana. This is the bigger, more
   demo-valuable piece and is genuinely new infrastructure — it also finally closes the
   deferred Hz-measurement gap in Topic Monitor.

**Effort:** large overall; thread (1) is small–medium, thread (2) is large (new
collection + export + UI, plus a decision on in-extension vs cluster-Prometheus rendering).
Recommend scoping the two threads as separate sub-tasks.

**Value:** strong for thread (2) — live robot/fleet metrics are a compelling, differentiated
demo and pair naturally with the Hummingbird Prometheus/Grafana companion images already in
the Layer Composer catalog (S9-3 supply-chain narrative → runtime observability narrative).
Thread (1) is lower-visibility but useful for product decisions.

---

<a id="s10-13"></a>

## S10-13 — Hybrid topology: local robot + in-cluster simulation & inference

**Ask:** run **one robot/pod locally** (on the user's machine via podman) while the
**simulation world and any inferencing/ML** run in OpenShift — the local robot and the
in-cluster workloads communicating across the boundary.

**Findings (verified in code, not assumed): this is genuinely new infrastructure — the two
current paths are fully independent and nothing crosses the boundary today.**
- **Local today** (`LocalSimulation.svelte`, backend `launchSimulation` → `entrypoint-gazebo.sh`):
  the **entire** sim — Gazebo world + all robots + Nav2 — runs in **one** container, all ROS
  nodes sharing one network namespace. Robots are added as extra `podman exec` spawns into
  that same container.
- **OpenShift today** (`OpenShiftSimulation.svelte`, `manifests.ts` → Deployment+Service+Route,
  `spawnRobotInOpenShift`): identical shape — the **whole** sim + robots + Nav2 run in **one**
  cluster pod, same image/entrypoints, only the transport differs (`oc exec` vs `podman exec`,
  the `ExecTarget` abstraction). Nothing runs locally when the OpenShift tab is used.
- **No cross-boundary ROS communication exists.** Zenoh support is present
  (`middleware: dds|zenoh`, `RMW_IMPLEMENTATION=rmw_zenoh_cpp`, an in-process `rmw_zenohd`
  started by `entrypoint-gazebo.sh`) but is **single-container/single-pod only** by explicit
  design — APPENG-5775 delivered the foundation, not a shared/cross-boundary router. The
  cross-pod / cross-boundary router+bridge design (central `zenoh-router` on TCP 7447,
  `zenoh-bridge-ros2dds` sidecars, per-side DDS isolation via `ROS_DOMAIN_ID` /
  `ROS_LOCALHOST_ONLY`, why DDS multicast fails over OVN-Kubernetes) is **documented but
  unbuilt** — see `repo-b-reference/multi-robot-openshift-proposal.md`,
  `docs/stories/story7-multipod-openshift-architecture.md`, `docs/design.adoc:388-482`. Those
  env keys / router config appear **only** in docs, zero occurrences in `packages/**` code.
- **No networking data-plane between local and cluster.** Local uses host port bindings
  (6080/8080 → `localhost`); cluster exposes only the noVNC edge-TLS Route; control-plane is
  `oc exec`/`oc get`. **No `oc port-forward`/tunnel anywhere.** A local robot has no path to
  reach in-cluster ROS services or vice versa today.
- **Inferencing/ML: greenfield — zero references** anywhere in the repo (no vllm/kserve/
  triton/modelmesh/model-serving). Existing GPU use is strictly Gazebo/sensor rendering, not
  ML. The "inference in OCP" half of this ask is entirely net-new.

**What this item actually requires (two large, mostly-unbuilt pieces):**
1. **A cross-boundary ROS transport** — the deferred Zenoh router/bridge design made real,
   with the router reachable from *outside* the cluster (Route/LoadBalancer/NodePort on 7447,
   or a port-forward tunnel) and DDS isolation on both sides. This is the hard networking core
   and overlaps heavily with the deferred multi-pod fleet work (APPENG-5766 / 5774 / 5775 /
   5776).
2. **In-cluster inference workloads** — a model-serving story that doesn't exist at all yet
   (which serving stack, GPU scheduling for *inference* vs rendering, how the local robot
   consumes it — a ROS topic/service the inference pod publishes, routed over the same Zenoh
   transport).

**Effort:** large — a multi-part spike, not a single sub-task. Recommend splitting: (a) the
cross-boundary Zenoh transport spike (builds directly on APPENG-5775's foundation and the
`repo-b-reference` proposal), then (b) a separate inference-in-cluster spike once the transport
proves out. Sequence both strictly after the deferred multi-pod fleet foundation, with which
(a) shares almost all of its infrastructure.

**Value:** high and strategically on-narrative (edge robot + cloud brains is a core Physical
AI story), but it is the largest item in this backlog and depends on currently-deferred
foundations — treat as research/spike, not a committed build, until the transport half is
proven.

---

<a id="s10-14"></a>

## S10-14 — Local Hummingbird nginx sidecar (Podman multi-container)

**Ask:** extend APPENG-6227's Hummingbird nginx sidecar (currently OpenShift-only) to the
local (Podman Desktop) simulation launch path as well.

**Findings (2026-09-01, verified in code):**
- Local sim launch (`launchSimulation`, `packages/backend/src/api-impl.ts:1035-1088`) is a
  single `containerEngine.createContainer` + `startContainer` call — no pod, network, or
  Compose involved. noVNC port 6080 is published directly host→container 1:1
  (`HostConfig.PortBindings`, line 1069-1071).
- **This is not blocked on a missing SDK capability, only on wiring.** The
  `@podman-desktop/api` package we already depend on exposes both
  `containerEngine.createNetwork(...)` and `containerEngine.createPod(...)` — confirmed
  present in the type defs, and confirmed **unused anywhere in this codebase today** (zero
  grep hits outside `node_modules`). Story 9's S9-2 write-up assumed local support needed
  APPENG-5774's full multi-container/Compose orchestration first; that's true for *general*
  N-robot orchestration, but this narrow, fixed-shape case (exactly 2 containers, fixed
  roles: sim + nginx) doesn't need that generality.
- **Two feasible approaches, with a real tradeoff:**
  1. **Podman pod** (`createPod`, then attach both containers via `ContainerCreateOptions.pod`)
     — shares one network namespace across pod members, exactly like an OpenShift pod.
     nginx keeps proxying to `127.0.0.1:6080`, reusing the *same* generated nginx config we
     already built for OpenShift — no config fork needed.
  2. **Podman user-defined network** (`createNetwork` + `HostConfig.NetworkMode` /
     `NetworkConfig.EndpointsConfig` joining both containers) — matches Red Hat's own
     documented "Configuring Cross-container Networking" recipe for this exact image
     (`podman network create`, then `--network <name>` on both `podman run`s, reachable by
     container name). Containers do **not** share localhost here, so nginx's `proxy_pass`
     would need to target `http://<sim-container-name>:6080` instead of `127.0.0.1:6080` —
     a genuine config difference between the local and OpenShift paths.
- **Real follow-on work either way** (roughly the same order of magnitude as the OpenShift
  side already shipped in APPENG-6227, not a trivial add-on):
  - `LocalSimulation.svelte`'s noVNC URL today comes from a direct host-port lookup against
    the *sim* container's own published ports (`hostPortForPrivate`,
    `packages/frontend/src/LocalSimulation.svelte:56-64`, resolved via
    `api-impl.ts:1195-1198`). With nginx as the entry point, this needs to resolve nginx's
    published port instead.
  - Teardown only knows about one container ID today — `stopSimulation`
    (`api-impl.ts:1105-1108`) and `deleteSimulation` (`api-impl.ts:1110-1125`) would need
    extending to also stop/remove the sidecar container and the pod/network.

**Effort:** small-to-medium, self-contained — does not need to wait on APPENG-5774.

**Recommendation:** worth a dedicated sub-task under Story APPENG-6225 (same parent as
APPENG-6227) rather than deferring to APPENG-5774. Prefer the **pod approach** (1) over the
network-join approach (2): it reuses the OpenShift-side nginx config verbatim instead of
forking it per deployment target.

---

<a id="s10-15"></a>

## S10-15 — Hummingbird registry-path audit (`quay.io` → `registry.access.redhat.com`)

**Ask:** audit whether other `quay.io/hummingbird/*` references in the extension should
move to the public `registry.access.redhat.com/hi/*` path, the way APPENG-6227 did for the
OpenShift nginx sidecar.

**Findings (2026-09-01):**
- For `nginx`: confirmed identical image content from both registries (matching
  Entrypoint/CMD/User/labels/source repo — same Konflux CI pipeline, same
  `gitlab.com/redhat/hummingbird/containers` source), and `registry.access.redhat.com/hi/nginx:latest`
  pulls with **zero authentication** (`podman pull`, no gate) — this is what APPENG-6227
  switched to for the OpenShift sidecar.
- The Layers wizard's `hummingbirdImageRef()` (`packages/shared/src/types/layerCompatibility.ts:88-90`)
  still hardcodes `quay.io/hummingbird/${app}:latest` for every other tool/companion option.
- **Verification pass completed (2026-09-01, via `skopeo inspect --override-arch amd64
  --override-os linux`, unauthenticated):** `cosign`, `jq`, `kubectl`, `helm`, and `curl` all
  confirmed to resolve to the **identical image digest** on both registries — same
  equivalence already established for nginx. No blockers found; this is a pure path swap for
  all five.
- `syft` is deliberately **out of scope here** — its registry path is handled together with a
  bigger architecture change; see [S10-16](#s10-16).

**Effort:** small — verification is done; remaining work is the code swap + updating any
tests/fixtures referencing the old `quay.io` path.

**Status:** filed as [APPENG-6263](https://redhat.atlassian.net/browse/APPENG-6263) under
Story APPENG-6225.

---

<a id="s10-16"></a>

## S10-16 — Hummingbird showcase: syft external-scan pattern + cosign bundled-tool demo

**Ask (raised 2026-09-01):** (1) is a separate external/"sidecar"-style container the right
approach for `syft`, or is it fine to keep it bundled into the final image as today? (2) Red
Hat treats both patterns as equally valid (see Findings below) — given that, is it still worth
switching? (3) if `syft` does move to the external pattern, should another Hummingbird tool
take its place as the demoed "bundled into your image" example, so both patterns still have a
live showcase — not just an available checkbox — the way SBOM generation demos `syft` today?

**Decision (2026-09-01):** yes to all three — move `syft` to the external/on-demand scan
pattern, and add `cosign` as the new demoed "bundled" example.

**Findings — Red Hat's documented bundling guidance (sidecar/external vs. tool-copy vs.
base-image):**
- Both patterns our own code already distinguishes (`companion` = run as its own container;
  `tool` = binary copied in) are **explicitly documented and treated as equally valid** by
  Red Hat — not one recommended over the other. The
  ["Build and deploy secure minimal containers with Red Hat Hardened Images"](https://docs.redhat.com/en/documentation/red_hat_hardened_images/1-latest/html/build_and_deploy_secure_minimal_containers_with_red_hat_hardened_images/index)
  guide names two workflows: *"running containerized tools"* (standalone/external execution —
  our companion analog, and what `syft` is moving to) and *"building custom application
  images"* (multi-stage `COPY --from`, our tool analog — with a `-builder` → `core-runtime`
  two-stage example). Red Hat's only prescriptive steer found was Hardened-Images-vs-UBI
  production suitability, not external-vs-tool.
  > **Caveat:** docs.redhat.com blocked direct fetch (HTTP 403) on this page both times it was
  > tried (initial research and again on 2026-09-01 re-check); the above is reconstructed from
  > search-indexed snippets, not a confirmed verbatim quote — verify against the live page (or
  > its PDF) before quoting externally.
- Catalog survey ([images.redhat.com](https://images.redhat.com/) is a JS SPA that couldn't be
  directly fetched/rendered; findings below are from indexed snippets only, not a rendered
  page): confirmed categories
  beyond nginx/syft — Python, Node.js, Go, Java, .NET runtimes; PostgreSQL, Valkey; HAProxy;
  curl; `-builder`/`core-runtime` base-image variants. "Over 45 images spanning 150+ variants"
  per Red Hat's own announcement. **No robotics/ROS images exist or are expected.** cosign
  itself doesn't appear to be a cataloged Hardened Image (no `hi/cosign` path found) — it's
  the *verification tool* used against other Hardened Images
  (`cosign verify --key ... registry.access.redhat.com/hi/<image>:<tag>`), distinct from the
  unrelated RHTAS Cosign image on Red Hat's main Ecosystem Catalog — don't conflate the two.

**Findings — why `syft` moves and why `cosign` is the right replacement (2026-09-01, verified
in code + registry, not assumed):**
- Today, `syft`'s binary is baked into the user's own built image
  (`COPY --from=quay.io/hummingbird/syft:latest`, `layerCompatibility.ts:172-177`), and the
  SBOM backend (`packages/backend/src/api-impl.ts:667-686`) execs it from inside that image
  (`podman run --rm <built-image-tag> syft dir:/ -o <format> ...`) — gated entirely behind the
  Layers wizard's "Syft" checkbox. Moving to Red Hat's own documented external pattern —
  `podman run --rm registry.access.redhat.com/hi/syft:latest <target-image-ref> --output
  <format>` — decouples SBOM generation from that gate and lets it scan *any* image, built or
  pulled.
- Checked every other currently-bundled ("tool") Hummingbird option — `cosign`, `curl`, `jq`,
  `kubectl`, `helm` — for actual runtime orchestration in the extension: **zero** are invoked
  anywhere in `packages/backend/src/api-impl.ts`, and only the Layers wizard's checkbox list
  references them in `packages/frontend/src` (confirmed via `rg`, no hits beyond that). `syft`
  is the *only* bundled tool with a live demo today — the "show its use to the user" gap is
  real for all five, not just hypothetical.
- `cosign` is the strongest replacement:
  - Already independently surfaced as a showcase idea in this doc before this decision was
    made — a "run `cosign verify` and show the result" flow directly parallels SBOM's
    "generate and show" pattern.
  - Strong narrative fit: SBOM answers "what's inside this image," cosign answers "is this
    image genuine" — together a complete supply-chain story, distinct from what's already
    shipped.
  - Confirmed via `skopeo inspect --override-arch amd64 --override-os linux` (unauthenticated):
    `quay.io/hummingbird/cosign:latest` and `registry.access.redhat.com/hi/cosign:latest`
    resolve to the identical digest `sha256:bd7bcc7cff2bb80087d66b44d361e2e98ec01aff8f8c17ea988fd7c331f457e8`
    — so the new demo can be built directly on the public, unauthenticated
    `registry.access.redhat.com` path from day one.
  - Ruled out: `curl`/`jq` are too generic for a compelling demo; `kubectl`/`helm` duplicate
    cluster-ops capability the extension already implements natively via `oc`.

**Scope:**
1. Redesign SBOM generation to run `syft` externally against the target image ref (Red Hat's
   documented pattern above) instead of execing a baked-in binary — a genuine architecture
   change touching `generateSbom`, its gating in `buildFromContainerfile`, and several tests.
2. Add a new "Verify Build" action using `cosign`, keeping the *bundled* pattern alive: bake
   it in via `COPY --from=registry.access.redhat.com/hi/cosign:latest` (mirrors `syft`'s *old*
   architecture), then run `podman run <built-image-tag> cosign verify --key ...
   <target-image-ref>` using the bundled binary to verify a Hummingbird base/companion image's
   signature, surfacing the result in the UI via APPENG-6226's existing SBOM-result display
   patterns (pretty-print, copy-to-clipboard).

**Clarified (2026-09-01) — `syft`'s wizard checkbox stays, but stops gating/mattering to our
own SBOM feature:**
- `syft` remains a selectable `tool` option in the Layers wizard (still bundleable via
  `COPY --from` for a user's own purposes) — but our SBOM feature no longer depends on it
  being checked at all. **"Generate SBOM" must become available unconditionally**, for any
  built image, since it no longer execs a binary that may or may not have been baked in.
  Whatever UI/backend gate currently keys "Generate SBOM" off the Layers wizard's Syft
  selection needs to be removed as part of this redesign, not just left in place accidentally.
- Once ungated, `syft`'s bundled-tool checkbox has **no live demo tied to it at all** — same
  inert status as `curl`/`jq`/`kubectl`/`helm` today (available to bake in, but nothing in our
  UI orchestrates it). `cosign` is the only bundled tool with an active, wizard-selection-gated
  demo ("Verify Build" appears/is enabled only when `cosign` is selected+bundled).
- Do **not** keep a second syft-from-the-bundled-binary demo path alongside the external one —
  one tool, one pattern, one showcase each: `syft` = external/on-demand, `cosign` = bundled.
  Splitting `syft` across both would undercut the reason `cosign` was added (filling the gap
  left by `syft` vacating the only-bundled-demo slot) for no narrative benefit.

**Effort:** medium–large — two coupled but separable pieces; the `syft` redesign is a real
architecture change, the `cosign` demo mostly reuses APPENG-6226's UI patterns.

**Status:** filed as [APPENG-6264](https://redhat.atlassian.net/browse/APPENG-6264) under
Story APPENG-6225.

**Showcase ideas surfaced (parking lot, not yet scoped or sized):**
- A Hardened-Images-as-base-image example (`-builder` → minimal-runtime multi-stage pattern)
  in the Layers wizard — distinct from today's tool-binary-copy pattern. Not sized; no Jira yet.

---

<a id="tracking"></a>

## Tracking: where each item currently lives

Update the **Current location** column as each item gets a real decision — a new sub-task
under an existing Story, a direct small commit, or a dedicated new doc.

| ID | Item | Kind | Current location |
|---|---|---|---|
| S10-1 | noVNC embedded in the extension | Feature | Filed as [APPENG-6283](https://redhat.atlassian.net/browse/APPENG-6283) under new Story [APPENG-6282](https://redhat.atlassian.net/browse/APPENG-6282) |
| S10-2 | Custom streaming-video viewer | Feature (research/spike) | Tracked under Story [APPENG-6282](https://redhat.atlassian.net/browse/APPENG-6282) (with S10-1), not yet sized/sub-tasked |
| S10-3 | SBOM layer/slice attribution & visualization | Feature | This doc |
| S10-4 | Per-slice incremental rebuild UX | Feature (mostly UX, caching likely already works) | This doc |
| S10-5 | OpenShift tab image picker | Feature | Filed as [APPENG-6259](https://redhat.atlassian.net/browse/APPENG-6259) under APPENG-6256, merged ([f18e69e](https://github.com/sgahlot/podman-desktop-extension-robotics/commit/f18e69e)), Closed |
| S10-6 | Topic Monitor OpenShift support | Feature | This doc |
| S10-7 | Dashboard OpenShift sim count | Feature | This doc — **still open**; not covered by S10-8's shipped work (verified 2026-09-02: `Dashboard.svelte` has only the 2 original tiles, no "N OpenShift" sub-tile) |
| S10-8 | Dashboard clickable metric tiles | Feature | Filed as [APPENG-6257](https://redhat.atlassian.net/browse/APPENG-6257) under APPENG-6256, merged ([455babe](https://github.com/sgahlot/podman-desktop-extension-robotics/commit/455babe)), Closed — scope was only the 2 pre-existing tiles, not S10-7's new OpenShift sub-tile |
| S10-9 | Get Started "Navigate" button | **Bug** | Filed as [APPENG-6260](https://redhat.atlassian.net/browse/APPENG-6260) under APPENG-6256, merged ([dc52d2c](https://github.com/sgahlot/podman-desktop-extension-robotics/commit/dc52d2c)), Closed |
| S10-10 | Auto-collapse base logs on Phase 2 build | Polish | Filed as [APPENG-6258](https://redhat.atlassian.net/browse/APPENG-6258) under APPENG-6256, merged ([a87b339](https://github.com/sgahlot/podman-desktop-extension-robotics/commit/a87b339)), Closed |
| S10-11 | CLI menu-driven help | Design requirement | **Gap:** S9-4/APPENG-6236 (the CLI itself) shipped and Closed (merged 58a9045) without this — the menu-driven no-args help was never folded in as intended. Needs its own follow-up ticket if still wanted; see [story9-platform-exploration.md](story9-platform-exploration.md), S9-4 |
| — | (ad hoc) Build-history/SBOM polling fixes + retention ceiling | Bug/perf fix | Filed as [APPENG-6265](https://redhat.atlassian.net/browse/APPENG-6265) under APPENG-6256 (discovered during the batch, not a pre-planned Story 10 item), merged ([9095642](https://github.com/sgahlot/podman-desktop-extension-robotics/commit/9095642)), Closed — touches the same `BuildHistoryPanel`/SBOM code S10-3/S10-4 discuss |
| S10-12 | Telemetry & richer metrics (OTEL/Prometheus) | Feature (2 threads: usage telemetry + runtime metrics) | This doc |
| S10-13 | Hybrid local robot + in-cluster sim/inference | Feature (research/spike; 2 large pieces) | This doc |
| S10-14 | Local Hummingbird nginx sidecar (Podman multi-container) | Feature | Filed as [APPENG-6262](https://redhat.atlassian.net/browse/APPENG-6262) under APPENG-6225 |
| S10-15 | Hummingbird registry-path audit (quay.io → registry.access.redhat.com) | Research/audit | Filed as [APPENG-6263](https://redhat.atlassian.net/browse/APPENG-6263) under APPENG-6225 |
| S10-16 | Hummingbird showcase: syft external-scan + cosign bundled-tool demo | Feature | Filed as [APPENG-6264](https://redhat.atlassian.net/browse/APPENG-6264) under APPENG-6225 |
