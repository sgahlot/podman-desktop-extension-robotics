# Story 9 — Platform & Tooling Exploration

> **Jira:** most items now have real tickets, filed individually to whatever Jira home fits each
> one best — some as new Stories under the epic (APPENG-5763), some as sub-tasks folded into an
> existing Story — never one umbrella "Story 9" ticket. See each item's section and the priority
> table below for its key. Story 8 (APPENG-6102, under epic APPENG-5763) is fully Closed; this
> doc remains the analysis/backlog record for how each item's priority and Jira home were decided.
>
> **Status (2026-08-27):** S9-2 (APPENG-6227) and S9-3 (APPENG-6226, **Closed**) filed under new
> Story APPENG-6225; S9-4 (APPENG-6236) filed under new Story APPENG-6235; S9-6 folded into
> existing APPENG-5809 (no separate ticket); S9-7 filed as APPENG-6237 under existing APPENG-5766;
> S9-1 filed as APPENG-6238 under existing APPENG-5767. S9-5 remains informational only (folded
> into S9-6's writeup, no ticket needed). Items are still numbered `S9-N` for reference, matching
> the `S8-N` convention.

## Table of Contents

- [Method](#method)
- [S9-1 — Replace `oc` CLI shell-outs with a Kubernetes/OpenShift client library (APPENG-6238)](#s9-1)
- [S9-2 — nginx sidecar (Hummingbird) for noVNC (APPENG-6227)](#s9-2)
- [S9-3 — Showcase a Hummingbird tool baked into the production image (APPENG-6226, Closed)](#s9-3)
- [S9-4 — CLI version of the extension (APPENG-6236)](#s9-4)
- [S9-5 — Follow up on the two bootc/Fedora ROS Slack links](#s9-5)
- [S9-6 — Sidecar containers: Fedora/RHEL/bootc base + ROS2 + Simulation-engine sidecar (folded into APPENG-5809)](#s9-6)
- [S9-7 — Externalize the hardcoded TurtleBot3 references (APPENG-6237)](#s9-7)
- [Priority recommendation](#priority-recommendation)
- [Cross-reference: what's already open and actionable now](#cross-reference)

## Method

Each candidate item below was researched against the actual codebase (not guessed) before being
prioritized — either directly or via a dedicated read-only investigation. Findings are cited with
file:line where relevant. Items are cross-checked against the currently open Physical AI Jiras
(epic APPENG-5763) to avoid duplicating work already tracked, and against yesterday's Slack
threads for anything that changes priority.

## Items

<a id="s9-1"></a>

### S9-1 — Replace `oc` CLI shell-outs with a Kubernetes/OpenShift client library (APPENG-6238)

**Ask:** use a library for all `oc` calls instead of the CLI.

**Findings:** ~13 `oc`-invoking call sites across ~10 methods in `api-impl.ts`, split cleanly into
two very different risk tiers:
- **Easy (read/list/delete):** `oc get deployment/pods/route`, `oc get projects`, `oc delete`,
  `oc whoami` — all map directly to `@kubernetes/client-node`'s `AppsV1Api`/`CoreV1Api` (Route and
  Project are OpenShift CRDs, reachable via `CustomObjectsApi`). Deploy already uses
  `extensionApi.kubernetes.createResources`, not the CLI — no change needed there.
- **Hard (exec):** `oc exec` (attached, for ROS/status commands) and `oc exec ... nohup` (detached
  background launch) require the client library's `Exec` class over a WebSocket/SPDY stream —
  functionally possible, but no clean equivalent for the current "detached nohup" trick, and a
  meaningfully more complex rewrite than the read/delete half.

No k8s/openshift client library is currently a dependency anywhere in the repo — this is a new
dependency. The existing test suite (`api-impl.spec.ts`) has ~15-20 test blocks tightly coupled
to `oc` argv shape (`expect(exec).toHaveBeenCalledWith('oc', [...])`) that would need a full
parallel rewrite.

**Effort:** Medium (read/delete half) + separately, higher-risk Large (exec half). **Recommend
splitting into two sub-items if pursued** — do the read/delete half first as a self-contained,
lower-risk improvement; treat `oc exec` migration as a distinct, later decision.

**Value:** better testability/mockability, one fewer external CLI dependency at runtime, no
functional user-facing change. Hygiene/robustness, not a demo feature.

<a id="s9-2"></a>

### S9-2 — nginx sidecar (Hummingbird) for noVNC (APPENG-6227, under Story APPENG-6225)

**Ask:** try using a Hummingbird nginx sidecar/container for noVNC instead of the current setup.

**Findings:** the current noVNC stack (`entrypoint-gazebo.sh`) already combines static-file
serving and WebSocket proxying in one process — `websockify --web /usr/share/novnc <port>
localhost:<vnc-port>`. An nginx sidecar would duplicate what websockify already does; it would
only add real value for TLS termination or hardened static serving, and OpenShift's Route already
terminates TLS at the edge, so there's little incremental value there. Locally, there's **no
multi-container/pod infrastructure at all today** — `api-impl.ts` launches sims via a single
`containerEngine.createContainer`/`startContainer` call (no `pod create`, no Compose, no `kube
play` anywhere in the codebase) — so enabling a sidecar locally means building generic
multi-container support first, not just adding one container.

**Cross-reference:** that missing local multi-container infrastructure is *exactly* what
**APPENG-5774** ("Podman Compose or pod-based multi-container orchestration for 2+ robots",
currently open, New) would need to build anyway. This item is a natural, low-cost *add-on* once
5774 lands — not a reason to build multi-container plumbing on its own.

**Effort:** small on OpenShift (Kubernetes Pods natively support multiple containers — appending
one to the existing single-container Deployment spec in `manifests.ts` is low-risk), but blocked
on new infrastructure locally.

**Reprioritized (2026-08-26) — the real driver is different from the original framing.** User
wants this specifically to **showcase a Hummingbird companion image running live, in the
extension's own OpenShift deploy** — the value isn't "improve noVNC technically" (which is
genuinely marginal, per the finding above), it's **demonstrating the Hummingbird companion pattern
working end-to-end in a real, running deployment**, for the active Hummingbird partnership
conversation. That reframes it: **Do soon, scoped to the OpenShift path** (already feasible today —
append `quay.io/hummingbird/nginx` as a second container in the Deployment spec, front noVNC or
serve a small dashboard through it). The local-path blocker (needs APPENG-5774's multi-container
work first) still applies and is out of scope for now — this is an OpenShift-only demo feature
until 5774 lands.

**Correction (2026-09-01) — APPENG-6227 is done (tested live, in Review, not yet merged to
`main`), and the "blocked on APPENG-5774" call above was wrong.** The OpenShift sidecar's image
is `registry.access.redhat.com/hi/nginx:latest`, not `quay.io/hummingbird/nginx` — see
`docs/stories/story10-post-roscon-product-backlog.md` S10-15 for why). Separately, re-investigating
the local path found the "no multi-container infrastructure" framing above (lines 78-82) was true
but overstated as a blocker: the `@podman-desktop/api` SDK already exposes both
`containerEngine.createNetwork(...)` and `containerEngine.createPod(...)` — unused anywhere in this
codebase, but not missing. A local nginx sidecar is a narrow, fixed-shape case (exactly 2
containers) that doesn't need APPENG-5774's general N-robot orchestration at all. Filed as its own
sub-task, **APPENG-6262**, rather than waiting on 5774 — full findings and the recommended approach
(Podman pod, not the network-join Red Hat's own docs show) are in
`docs/stories/story10-post-roscon-product-backlog.md` S10-14.

<a id="s9-3"></a>

### S9-3 — Showcase a Hummingbird tool baked into the production image (APPENG-6226, Closed — under Story APPENG-6225)

**Ask:** show a Hummingbird bundled image/tool (jq, kubectl, or helm) actually in use in our
image, not just the experimental Layers wizard.

**Findings:** the `COPY --from=quay.io/hummingbird/<tool>:latest` pattern already exists and is
proven (APPENG-6108's Layers wizard) — but only there. The production Containerfiles
(`ros2-jazzy-base`/`ros2-jazzy-sim`) reference no Hummingbird image at all, and no entrypoint
script shells out to `jq`/`kubectl`/`helm` today, so a baked-in tool would currently be
**decorative** — nothing calls it.

**Open unknown:** whether Hummingbird images publish for both `arm64` (local Mac) and `amd64`
(OpenShift) isn't documented anywhere in the S8-14 spike findings (its arch findings are about
ROS/dnf packages, not Hummingbird) — worth a quick `skopeo inspect --override-arch arm64` check
before committing, given the production images are multi-arch.

**Effort: small.** One `COPY --from` line, same pattern already proven.

**Value:** good demo value for the ongoing Hummingbird partnership conversation (a real, working
example of "Red Hat hardened supply chain in the same image as your robot"), **but should be
paired with one trivial real call site** (e.g. an entrypoint log line that actually runs the
baked-in tool) so it's not purely decorative. **Recommend as a near-term, low-risk item.**

<a id="s9-4"></a>

### S9-4 — CLI version of the extension (APPENG-6236, under Story APPENG-6235)

**Ask:** reuse the same codebase to provide all existing functionality via a CLI — either Makefile
targets or a standalone app (TypeScript or otherwise).

**Findings — more tractable than it first sounds:**
- `packages/shared/src/` is **already fully decoupled** from `@podman-desktop/api` (the only
  import is a type-only `Webview` reference in the RPC bridge, erased at compile time) — directly
  reusable as-is.
- `api-impl.ts`'s ~59 public methods funnel through **three chokepoints**:
  `extensionApi.process.exec` (13 sites — a thin wrapper, essentially the same shape as
  `child_process.execFile`, trivially swappable), `extensionApi.containerEngine.*` (~15 sites —
  Docker/Podman-engine-API-shaped payloads, swappable for the `podman` CLI or its REST socket),
  and `extensionApi.configuration.getConfiguration` (16 sites, simple get/update, swappable for a
  config file or env vars).
- No existing CLI scaffolding anywhere (no `bin` entry, no commander/yargs/oclif) — starts from
  zero tooling, but not from zero logic.

**Effort: Medium** — a real compatibility-shim/adapter project (not a from-scratch reimplementation),
touching most of the 59 methods' plumbing, but reusing the actual business logic as-is.

**Open question before scoping further:** *why* is a CLI wanted — headless CI/scripting, a
non-Podman-Desktop-user path, or automated demo setup? The driver changes what "provide all
existing functionality" actually needs to cover (e.g. a CI-only CLI wouldn't need the interactive
robot-control/Nav2 flows at all). **Recommend clarifying the driving use case before committing
effort here.**

<a id="s9-5"></a>

### S9-5 — Follow up on the two bootc/Fedora ROS Slack links

**Ask:** review the links shared in the two Slack threads for bootc/Fedora ROS image options.

**Findings:** both links point to resources **already investigated** during the APPENG-6108 spike
(see memory `secure-base-spike-findings`) — `docs.fedoraproject.org/en-US/robotics-sig/ros2` (the
Fedora Robotics SIG docs, blocked by an Anubis bot-challenge, but its underlying repo was cloned
and inspected directly) and `gitlab.com/fedora/sigs/robotics/images/bootc-images` (the `ros-rpms`
COPR-based install path and the `ros-containers` Quadlet-based sidecar pattern). Saypaul
independently pointed at the same two resources on 2026-08-26, after our findings were already
posted — confirming alignment, not new information.

**Also found (Hummingbird-meeting side-channel):** Chris Custine confirmed Red Hat is sponsoring
OSRA infrastructure to enable official Fedora/CentOS ROS2+Gazebo builds upstream — real, but a
future/unscheduled effort. **Corrected priority guidance (2026-08-26): don't gate our own
evaluation on OSRA's timeline.** The Quadlet-sidecar pattern found below is orthogonal to whether
OSRA ever ships native Fedora packages — it works today, independent of upstream packaging,
because it doesn't rely on native packaging at all. OSRA is useful context, not a reason to wait.

**More directly useful — links already in our own Jira (APPENG-5809 comment, 2026-07-23), not
Slack, and independent of OSRA entirely:**
- **[REP 2000](https://reps.openrobotics.org/rep-2000/)** — ROS 2's own official platform-tier
  spec. For Jazzy: **Ubuntu Noble is Tier 3, RHEL 9 is Tier 2 — Fedora isn't listed at all.**
  RHEL 9 having *official, ROS-project-sanctioned* Jazzy support is a materially different, more
  solid foundation than any Fedora community/COPR path.
- **[docs.ros.org RHEL-Install-RPMs](https://docs.ros.org/en/jazzy/Installation/RHEL-Install-RPMs.html)**
  — official ROS 2 Jazzy RPM install instructions for RHEL 9. Cross-references cleanly with our
  own S8-14 spike data: `centos-bootc:stream9` (el9, ABI-compatible with RHEL 9) had ~1,455
  `ros-jazzy-*` RPMs on x86_64 via the *official* `packages.ros.org/ros2/rhel/9/` repo — real
  ROS 2 **core** packages, officially available — but **zero simulation-stack packages** (no
  Nav2, no Gazebo, no `nav2-minimal-tb3-sim`) on any arch. This matches REP 2000's Tier-2 scope
  exactly: ROS 2 core is RHEL-supported; Gazebo/Nav2/sim are separate upstream projects with their
  own (narrower) platform tiers that don't extend to RHEL/Fedora for the simulation pieces.
- **[nickschuetz/ros2-rpm](https://github.com/nickschuetz/ros2-rpm)** — a community Fedora RPM
  build, explicitly flagged (by our own earlier Jira comment) as development-only, not
  vendor-supported or CVE-tracked — too risky as a demo base on its own.

**Net effect on S9-6 below:** the "base" in "base + ROS2 + sim" doesn't have to be a
Fedora-flavored bootc guess — it can legitimately be **RHEL 9 bootc**
(`registry.redhat.io/rhel9/rhel-bootc`, already in our bootc catalog), which gets ROS 2 **core**
natively via official RPMs. What's still missing natively on *any* RHEL/Fedora/CentOS el9 base is
the **simulation stack specifically** — which is exactly the gap a ROS2+sim sidecar container
closes, regardless of which el9 flavor sits underneath.

<a id="s9-6"></a>

### S9-6 — Sidecar containers: Fedora/RHEL/bootc base + ROS2 + Simulation-engine sidecar (folded into APPENG-5809)

**Ask (clarified 2026-08-26):** evaluate a **base OS (Fedora/RHEL/bootc) with a sidecar container
that runs ROS2 + the simulation engine** — three distinct layers (base / ROS2 / sim), not a vague
"bootc option." Evaluate this **independent of OSRA** — don't treat OSRA's future upstream-packaging
effort as a reason to defer.

**Findings:** this maps directly to the `ros-containers` Quadlet pattern in the Fedora Robotics
SIG's own repo (`gitlab.com/fedora/sigs/robotics/images/bootc-images`) — running our existing
Ubuntu-based ROS2+sim image *as a container*, bound into a bootc **host** (Fedora, RHEL, or CentOS
Stream — the pattern itself is base-OS-agnostic) via `bootc`'s `bound-images.d` mechanism + a
systemd-managed Podman Quadlet unit. Crucially, **this approach needs no native ROS/Gazebo
packaging on the host at all** — it sidesteps the entire "does el9 have Nav2 RPMs" question found
above, which is exactly why it's independent of both OSRA (future native packaging) and REP 2000's
Tier-2 scope (native ROS2 core support, but not sim). The base OS just needs `bootc` + `podman` +
`systemd` — any of the bootc catalog options already in our wizard (Fedora, CentOS Stream, or now
also RHEL 9, per S9-5) would work as the host.

This is a genuinely different deployment target than either of this extension's current two modes
(local Podman Desktop on the dev's OS, or an OpenShift pod) — bootc is about the *host OS itself*
being an immutable bootable container image, a cluster/edge-device-admin-level concern. It connects
to the ROSCon "Deploy" image conversation with saypaul/kpanchal (edge node running the final robot
app) more than to the extension's existing Dev/Build or Simulation paths.

**Effort:** the sidecar/Quadlet pattern itself is proven elsewhere and testable now (build a bootc
image with our sim image bound in as a Quadlet unit, boot it, confirm ROS2+Gazebo come up as a
container on top) — a genuine, self-contained spike, not blocked on anything external. Scoping
"does the extension need to author bootc images, invoke `bootc-image-builder`, or is this a
documentation/reference-architecture deliverable only" is the real open question for sizing beyond
the spike.

**Recommend:** fold into APPENG-5809 (Fedora base migration) as its next concrete spike step, with
precise scope — "prototype ROS2+sim as a Quadlet sidecar on a bootc host (Fedora/RHEL/CentOS),
independent of native packaging or OSRA" — not a vague "look at Fedora again."

<a id="s9-7"></a>

### S9-7 — Externalize the hardcoded TurtleBot3 references (plug-and-play robot support) (APPENG-6237)

**Ask (clarified 2026-08-26):** not "add a second robot" — **remove the hardcoded TurtleBot3
references and externalize them into config**, so a new robot becomes a real plug-and-play
addition later, rather than an entrypoint-script rewrite.

**Findings:** confirmed directly — TurtleBot3 is hardcoded, not parameterized, in exactly these
places:
- `packages/backend/assets/ros2-jazzy-sim/entrypoint-spawn-robot.sh:40-48` — literal
  `turtlebot3_waffle.urdf` path, `nav2_minimal_tb3_sim` package name in the `ros2 launch` call,
  `TURTLEBOT3_MODEL` env var.
- `entrypoint-gazebo.sh:52-53,279-290` — same URDF path and package name duplicated.
- Likely also: robot-specific defaults in `SimulationConfig`/`SimulationProfiles.ts` (spawn
  form defaults, Nav2 params file templating) — needs a full audit, not just the two entrypoint
  scripts, to find every place a robot identity is assumed rather than passed through.

**What "externalized" should mean concretely:** a robot definition becomes a small, self-contained
descriptor (URDF/description package name, minimal-sim launch package + entry point, default
model/variant, Nav2 params template) that the entrypoint scripts consume as parameters instead of
literals — the same shape as how `SimulationBaseImages.ts` already externalizes base-image presets
today. TurtleBot3 becomes the *first* (and for now, only) entry in that catalog, not special-cased
code.

**Effort:** small-to-medium — this is a refactor of existing, working code (extract + parameterize),
not new functionality, and the current TurtleBot3-only behavior must remain byte-identical after
the change (regression risk is entirely in the entrypoint scripts, which have direct shell-script
test coverage already per `entrypoint-security.test.sh`).

**Note:** this externalization is valuable on its own (cleaner code, sets up future robots to be
additive) even before a second robot is ever added — per S9-7's original research, actually
*adding* a second robot remains real per-robot integration work (sourcing/building its URDF and a
working minimal-sim launch file), which is unaffected by this refactor's scope and still has no
demo-scope signal calling for it yet.

**Recommend:** worth doing as infrastructure hygiene ahead of any future robot addition — bounded,
testable, and removes a real design smell (robot identity hardcoded in shell scripts) independent
of whether a second robot ever gets added.

<a id="priority-recommendation"></a>

## Priority recommendation

| Tier | Item | Status | Why |
|---|---|---|---|
| Done | APPENG-5775 Zenoh router | **Closed** | Single-container/pod `rmw_zenoh_cpp` foundation shipped and live-tested (local + OpenShift). Cross-container fleet win still needs 5774/story7. |
| Done | S9-3 (Hummingbird tool showcase) | **Closed** (APPENG-6226) | `syft` baked in with a real use case (SBOM generation), shipped as part of the Hummingbird showcase story. |
| Done | S9-2 (Hummingbird nginx sidecar, OpenShift-only) | **Review** (APPENG-6227), tested live, not yet merged | See the Correction (2026-09-01) note above. Local-path follow-on filed separately as **APPENG-6262** (not blocked on APPENG-5774 after all — see story10 S10-14). |
| **In progress** | S9-7 (externalize TurtleBot3 → config-driven robot definition) | **In Progress** (APPENG-6237), parallel worktree | Bounded refactor, real design-smell fix, sets up future robots as additive rather than a rewrite. |
| **In progress, self-contained spike** | S9-6 (Quadlet ROS2+sim sidecar on a bootc base) | **In Progress**, folded into APPENG-5809, parallel worktree | Proven pattern elsewhere, testable now, independent of OSRA and of native ROS/sim packaging entirely. |
| **In progress** | S9-1 (oc → library), read/delete half only | **New** (APPENG-6238) | Real robustness/testability payoff, bounded and low-risk if the `oc exec` half is deliberately deferred. Sequence relative to other OpenShift-area work (6070/6227/5778) touching the same methods — don't run simultaneously with them. |
| **In progress** | S9-4 (CLI version) | **In Progress** (APPENG-6236, under Story APPENG-6235), parallel worktree | Genuinely more tractable than expected (shared/ already decoupled); driving use case (headless CI vs. non-PD-user path vs. demo automation) still needs to be resolved early in that ticket. |
| **Informational only, already actioned** | S9-5 (bootc/Fedora links) | No ticket (by design) | Both Slack links already investigated; the more valuable find was in our own Jira comments (REP 2000 + RHEL RPM docs) — folded into S9-6 above. |

<a id="cross-reference"></a>

## Cross-reference: what's already open and actionable now

From the current Physical AI epic (APPENG-5763), independent of anything above:

- **APPENG-5775** — Zenoh router (native `rmw_zenoh_cpp`) — **Closed**. Single-container/pod
  foundation shipped and live-tested; cross-container fleet win still needs 5774/story7's
  multi-pod split (tracked separately as **APPENG-6070**, In Progress, parallel worktree).
- **APPENG-5774** — Podman Compose/pod-based multi-container orchestration for 2+ robots (New) —
  would also unlock S9-2 as a trivial add-on later.
- **APPENG-5809** — Migrate ROS2 Jazzy base image from Ubuntu to Fedora (**In Progress**, parallel
  worktree) — now folding in the S9-6 Quadlet-sidecar spike as its next concrete step.
- **APPENG-5778** — Kind cluster integration for local validation (New).
- **APPENG-5779** — Getting-started guide for the full workflow (New).
- **APPENG-5776** — Fleet status panel in the extension UI (New) — blocked on APPENG-5774.
- **APPENG-5810** — Robot debugging visibility (TF/sensor/costmap state) — textual diagnostics
  first, visual tool later (retitled 2026-08-27, was "Add rviz2/desktop variant of the base
  image"; **In Progress**, parallel worktree).
- **APPENG-6071** — Port Jazzy sim-image improvements to the Humble image (**In Progress**,
  parallel worktree) — not from this doc's original 7 items, but tracked under the same epic.

**Jira status for every Story 9 item (as of 2026-08-27):** S9-2 → APPENG-6227 (New), S9-3 →
APPENG-6226 (**Closed**), S9-4 → APPENG-6236 (**In Progress**, under Story APPENG-6235), S9-5 → no
ticket (informational, folded into S9-6), S9-6 → folded into APPENG-5809 (**In Progress**), S9-7 →
APPENG-6237 (**In Progress**), S9-1 → APPENG-6238 (New). See each item's section above for the
full writeup behind its Jira home.
