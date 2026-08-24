# APPENG-6108 (Story 8, Batch F) — Secure base spike: S8-14 → S8-15

**Status:** S8-14 (feasibility spike) **done — verdict NO-GO natively today**. S8-15
(layer-composition wizard) **prototype code-complete** on
`feature/APPENG-6108-secure-base-spike` (commits `4e608f6`, `528a6df`, `a0f8463`,
`22e784c`) — awaiting user testing + merge to `main`. The Hummingbird app list now
mirrors the real `quay.io/hummingbird/*` catalog and both the wizard and Help note that
the bootc/Hummingbird layers come from the `redhat.bootc` / `redhat.hummingbird`
extensions (install them and pull the images locally to use the layers for real). See
[Story 8 — Batch F](story8-extension-ux-enhancements.md#s8-wizard) for the tracking table.

---

## Question (S8-14)

Can ROS 2 Jazzy (the full apt/dnf robotics + simulation stack) layer onto a **hardened,
minimal secure base** — either a **bootc** bootable-container image (`redhat.bootc`
extension) or a **Hummingbird**-hardened runtime image (`redhat.hummingbird`
extension) — today, natively, without dropping to source builds or third-party package
channels?

This spike also asked a second, narrower question: are the `redhat.bootc` /
`redhat.hummingbird` Podman Desktop extensions themselves something this extension could
call into programmatically to build or obtain such a base?

## Method

Empirically probed dnf repo availability for ROS 2 Jazzy against the two candidate secure
bases, on both the arches the extension targets (native arm64 for local dev, x86_64 for
OpenShift):

- **`centos-bootc:stream9`** (el9) — checked whether the ROS 2 el9 dnf repo
  (`packages.ros.org`) has any `ros-jazzy-*` packages, on both arm64 and x86_64, and
  specifically whether the simulation stack (Nav2, Gazebo/`ros-gz-sim`) is present.
- **`fedora-bootc:43`** — checked whether an official ROS Fedora repo exists at all.
- Inspected the `redhat.bootc` and `redhat.hummingbird` extension manifests/APIs to
  determine what, if anything, this extension could invoke or reuse from them.

## Findings

### centos-bootc:stream9 (el9)

- **Native arm64: the ROS el9 repo is empty** — 0 packages. Not a partial gap; nothing
  ROS-related resolves at all.
- **x86_64: ~1,455 `ros-jazzy-*` RPMs exist**, but **the simulation stack is absent on
  every arch**, x86_64 included: no `navigation2`, no `nav2-bringup`, no
  `nav2-minimal-tb3-sim`, no `ros-gz-sim`, no `gz-sim-vendor` — no Gazebo at all. A
  robotics image with no Nav2 and no Gazebo can't run this extension's simulation flows,
  so even the x86_64 package availability doesn't clear the bar.
- **Packaging hygiene problems on top of the gap:** the available RPMs are **unsigned**
  (`gpgcheck` must be disabled to install them), and `packages.ros.org` serves a
  **mismatched `*.osuosl.org` TLS certificate** (`sslverify=0` is required). Both are
  the kind of relaxation a "secure base" story is explicitly trying to avoid.

### fedora-bootc:43

- **No official ROS Fedora repo exists at all.** Nothing to point dnf at.

### Relationship to APPENG-5809

This confirms and extends the already-parked **APPENG-5809** (Ubuntu → Fedora base
migration, parked because Jazzy has no official Fedora packages per
[REP 2000](https://reps.openrobotics.org/rep-2000/): Ubuntu Noble is Tier 1, RHEL 9 is
Tier 2, Fedora isn't a REP 2000 platform at all). S8-14 shows the same gap holds one
level deeper: even accepting a RHEL/CentOS-family (el9) target instead of Fedora, and
even accepting an *unsigned, TLS-unverified* package channel, the simulation half of the
stack simply isn't published for that platform on any architecture. See
[podman-extension-plan.md](../podman-extension-plan.md#follow-up-tasks-from-appeng-5769-scope-adjustments)
and [story1-scaffolding.md](story1-scaffolding.md) for the original APPENG-5809 writeup.

### Build-time vs. runtime — the key nuance

A **bootc base image alone builds and runs fine** — `centos-bootc:stream9` /
`fedora-bootc:43` are valid, functional bootable-container bases. The failure shows up
one step later: **layering our existing apt-based ROS/Sim asset scripts onto a bootc
(dnf-based, no `apt`) base fails at *build* time**, not at runtime — either because
`apt` doesn't exist on the base at all, or because the equivalent dnf packages don't
exist for that distro/arch (per the Findings above). This is a meaningfully different
failure mode than "it builds but crashes when you run it": nothing ever produces an
image to run. By contrast, **Ubuntu + ROS 2 Jazzy + the simulation layer builds and runs
today** — that's the extension's current shipping base and is unaffected by this spike.

### Extension reuse reality (`redhat.bootc` / `redhat.hummingbird`)

- **`redhat.bootc`** provides dnf-based bootable OS bases (`centos-bootc`,
  `fedora-bootc`, `rhel-bootc`) and exposes a `bootc.image.build` command. It does
  **not** expose a programmatic `exports` API for other extensions to call into.
- **`redhat.hummingbird`** is **not an OS base** — it's a client for a remote catalog
  API that maps common application images (nginx, python, node, …) to hardened
  `quay.io/hummingbird/<name>` alternatives. It has **no commands and no exports**
  either, and nothing in its catalog resembles a ROS/robotics base.
- **Realistic reuse for either extension, today:** declare an `extensionDependencies`
  entry on the other extension and then consume a built/pulled image **by reference**
  (image tag/digest) — optionally triggering `bootc.image.build` as a command
  invocation. Neither extension exposes a callable API surface beyond that; there's no
  way to, say, ask `redhat.bootc` in-process "give me a bootc image with package X
  layered on" — only shell out to `bootc.image.build` and then reference the resulting
  tag.

### Why the wizard's layer lists aren't queried "live"

A natural expectation is that the wizard should populate its bootc bases and its
Hummingbird hardened-app images by querying those extensions directly, instead of
carrying a hardcoded list. It can't today, for a concrete reason worth recording so it
can be answered later: **seeing an image in an extension's own UI does not mean another
extension can read that list programmatically.** For that, the source extension has to
*expose* the data — via `extension.exports` (a JS API), a contributed command that
returns it, or a documented endpoint.

- **`redhat.bootc`** exposes neither: `exports` is `undefined`, and its only command
  (`bootc.image.build`) doesn't return a catalog. Its base list lives hardcoded in its
  own source (that's what its UI renders). So a "live" bootc list would just mean
  **duplicating the same static list bootc itself maintains** — no dynamism is actually
  gained.
- **`redhat.hummingbird`** also exposes no `exports` and no commands; it fills its own UI
  from a **remote HTTP catalog** (`api-hummingbird…`). We *could* call that same endpoint
  ourselves, so a live Hummingbird list is technically possible — but it is a
  third-party, undocumented network API, so it needs loading/error/timeout handling and
  can change shape without notice. That fragility (and that it would cover only
  Hummingbird, not bootc) is why it isn't the prototype default.

**Chosen path.** Hardcode a curated catalog now, and (planned fast-follow) decorate it
with **local availability** using the extension's existing local-image listing
(`listLocalImages()`): show the known layers and mark which are actually pulled on this
machine. That pairs naturally with declaring `redhat.bootc` / `redhat.hummingbird` as
prerequisites and letting the user pull the images themselves — giving real, per-machine
dynamism **without** depending on any remote or private API. The same completion note is
mirrored on the Jira for future reference.

### Non-native alternatives (not pursued for the MVP)

Two paths exist to get ROS 2 Jazzy onto a non-Ubuntu/non-apt base, neither viable for a
shipping demo image today:

- **conda-forge / RoboStack** — installs ROS 2 packages via conda regardless of the
  underlying OS packaging, so it sidesteps the apt/dnf gap entirely. Adds a second
  packaging ecosystem and its own image-size/maintenance overhead.
- **Build from source** — always technically possible, but is a maintenance sink and
  dev-only in practice (build times, pinning every transitive dependency, keeping pace
  with Jazzy patch releases).

## Decision & pivot (S8-15)

Given the NO-GO verdict, continuing to chase a specific "secure base + ROS + Sim" build
today would be spending effort on a combination that structurally can't succeed until
upstream ROS packaging catches up (tracked passively via APPENG-5809's revisit
triggers). Instead, Batch F pivoted to a **prototype** that showcases the *user
experience* of composing a secure image now, so it "just works" the moment a viable
secure ROS/Sim layer exists upstream — without hard-coding today's infeasibility into
the UI.

The image the wizard describes **doesn't need to be buildable today**. Infeasible
combinations get a clear warning, not a hard block — there's an **"Attempt anyway"**
escape hatch for exploration, dev-only source builds, or a future world where a given
combination becomes viable.

## What was built

A **layer-composition wizard**: users freely pick a Base OS + hardened layer + ROS
layer + Simulation layer and get a live **3-state compatibility verdict** per
combination:

- ✅ **Ready** — the combination is expected to build and produce a working robotics
  image.
- ⚠️ **Builds, but not a robotics image** — e.g. a bootc/hummingbird base alone, with no
  ROS/Sim layer chosen, builds fine but has nothing robotics-related on it.
- ❌ **Won't build** — names the specific failing build step (e.g. "no apt on this
  base" / "ROS Jazzy sim packages unavailable for this distro/arch"), per the
  Findings above.

Implemented as a third mode, `'layers'`, of the existing
`physical-ai.imageBuilderLayout` preference (alongside `guided` and `pipeline`).

Key files:

- `physical-ai/packages/shared/src/types/layerCompatibility.ts` — the pure
  compatibility engine: `evaluateStack()` (produces the 3-state verdict for a chosen
  layer combination) and `generateLayerContainerfile()` (renders the corresponding
  Containerfile for a combination, whether or not it's marked Ready).
- `physical-ai/packages/frontend/src/lib/LayerComposer.svelte` — the wizard UI (layer
  pickers + live verdict + "Attempt anyway" escape hatch).
- `physical-ai/packages/frontend/src/SimulationSetup.svelte` — wires the `'layers'`
  mode into the existing Image Builder layout switcher alongside `guided`/`pipeline`.

Branch: `feature/APPENG-6108-secure-base-spike`. Commits: `4e608f6` (foundation — engine
+ `'layers'` mode plumbing), `528a6df` (wizard UI, prototype), `a0f8463` (wizard + Help
notes that the layers come from the `redhat.bootc` / `redhat.hummingbird` extensions),
`22e784c` (Hummingbird app list corrected to the real `quay.io/hummingbird/*` catalog;
R5 downgraded warn→info so Hummingbird-alongside-ROS reads ✅ Ready). **Not yet merged to
`main`** — awaiting user testing before merge, per this project's zero-errors-on-merge /
merge-to-main-before-Closed workflow.

## Manual test matrix

These rows are generated directly from the compatibility engine (`evaluateStack()`), so
the **Verdict / Fails-at / Build-button** columns are exactly what the wizard renders for
each combination. Use them to exercise every rule path in the UI.

**Legend** — Verdict: ✅ Ready (builds and is a working robotics image) · ⚠️ Builds, not a
robotics image · ❌ Won't build. Build button: *Enabled*, or *Disabled* until you tick
**Attempt anyway**. "Fails at" is the build step named on a blocked combination.

**How to run it:** open **Image Builder**, switch the layout switcher to **Layers**, then
for each row set Base OS / Hardened / ROS / Simulation to the row's values (and, where the
Hardened column names apps, select **Hardened app = Hummingbird app** and tick those app
checkboxes). Confirm the banner verdict, the "Fails at build step" line, and the Build
button state match the table; for ❌ rows also confirm ticking **Attempt anyway** re-enables
Build and that clicking it shows the prototype notice.

| # | Base OS | Hardened | ROS | Sim | Verdict | Fails at | Build button |
|---|---------|----------|-----|-----|---------|----------|--------------|
| 1 | Ubuntu Noble | None | Jazzy | Gazebo+Nav2+TB3 | ✅ Ready | — | Enabled |
| 2 | Ubuntu Noble | None | Humble | Gazebo+Nav2+TB3 | ✅ Ready | — | Enabled |
| 3 | Ubuntu Noble | None | Jazzy | None | ✅ Ready | — | Enabled |
| 4 | Ubuntu Noble | None | Humble | None | ✅ Ready | — | Enabled |
| 5 | Ubuntu Noble | None | None | None | ⚠️ Builds, not robotics | — | Enabled |
| 6 | Ubuntu Noble | None | None | Gazebo+Nav2+TB3 | ❌ Won't build | sim-install | Disabled |
| 7 | Ubuntu Noble | Hummingbird (nginx) | Jazzy | Gazebo+Nav2+TB3 | ✅ Ready | — | Enabled |
| 8 | Ubuntu Noble | Hummingbird (nginx+nodejs) | Humble | Gazebo+Nav2+TB3 | ✅ Ready | — | Enabled |
| 9 | Ubuntu Noble | Hummingbird (nginx) | None | None | ⚠️ Builds, not robotics | — | Enabled |
| 10 | CentOS bootc S9 | None | None | None | ⚠️ Builds, not robotics | — | Enabled |
| 11 | CentOS bootc S9 | Hummingbird (nginx) | None | None | ⚠️ Builds, not robotics | — | Enabled |
| 12 | CentOS bootc S9 | None | Jazzy | None | ❌ Won't build | ros-install | Disabled |
| 13 | CentOS bootc S9 | None | Humble | None | ❌ Won't build | ros-install | Disabled |
| 14 | CentOS bootc S9 | None | Jazzy | Gazebo+Nav2+TB3 | ❌ Won't build | ros-install | Disabled |
| 15 | CentOS bootc S9 | None | Humble | Gazebo+Nav2+TB3 | ❌ Won't build | ros-install | Disabled |
| 16 | CentOS bootc S9 | Hummingbird (nginx) | Jazzy | Gazebo+Nav2+TB3 | ❌ Won't build | ros-install | Disabled |
| 17 | CentOS bootc S9 | None | None | Gazebo+Nav2+TB3 | ❌ Won't build | sim-install | Disabled |
| 18 | CentOS bootc S10 | None | Jazzy | None | ❌ Won't build | ros-install | Disabled |
| 19 | Fedora bootc 43 | None | None | None | ⚠️ Builds, not robotics | — | Enabled |
| 20 | Fedora bootc 43 | None | Jazzy | None | ❌ Won't build | ros-install | Disabled |
| 21 | Fedora bootc 43 | None | Humble | None | ❌ Won't build | ros-install | Disabled |
| 22 | Fedora bootc 43 | Hummingbird (python) | Jazzy | Gazebo+Nav2+TB3 | ❌ Won't build | ros-install | Disabled |
| 23 | Fedora bootc 42 | None | Jazzy | None | ❌ Won't build | ros-install | Disabled |
| 24 | RHEL bootc 9 | None | None | None | ⚠️ Builds, not robotics | — | Enabled |
| 25 | RHEL bootc 9 | Hummingbird (nginx) | None | None | ⚠️ Builds, not robotics | — | Enabled |
| 26 | RHEL bootc 9 | None | Jazzy | None | ❌ Won't build | ros-install | Disabled |
| 27 | RHEL bootc 9 | None | Jazzy | Gazebo+Nav2+TB3 | ❌ Won't build | ros-install | Disabled |
| 28 | RHEL bootc 9 | None | Humble | Gazebo+Nav2+TB3 | ❌ Won't build | ros-install | Disabled |
| 29 | RHEL bootc 10 | None | None | None | ⚠️ Builds, not robotics | — | Enabled |

Notes on specific rows:

- **Rows 7–8 (Hummingbird alongside a full ROS+Sim stack) read ✅ Ready** — Hummingbird
  hardened app images are an optional side component; they don't change the Ubuntu ROS
  build, so the combination still produces a working robotics image (the wizard shows an
  informational note to that effect, not a warning).
- **Rows 10, 19, 24, 29 (and 11, 25) — a bootc base with no ROS layer — read ⚠️.** RHEL
  rows additionally carry a "requires a Red Hat subscription (registry.redhat.io)" warning.
- **Rows 12–16, 18, 20–23, 26–28 fail at `ros-install`**: ROS layers install via `apt` on
  Ubuntu, and the dnf-based bootc bases have no ROS Jazzy/Humble sim packages — the build
  fails the moment it tries to install ROS. **Row 17 fails at `sim-install`** (a bootc base
  with a sim layer but no ROS) — same el9-RPM gap, one step earlier in the chain. Rows 18 /
  23 / 29 also prove the Stream 10 / Fedora 42 / RHEL 10 variants behave identically to
  their family siblings.
- **Rows 5 & 9 (bare Ubuntu / Ubuntu + Hummingbird, no ROS) read ⚠️ "not a robotics
  image yet"** — the same classification any base with no ROS layer gets. This closed a
  gap in the original hand-written rules (a non-bootc base with no robotics layers fell
  through to a blank ✅). See "Why the verdict is derived, not hand-written" below.

### Hummingbird app sub-layer (drill-down) checks

- Selecting **Hardened app = Hummingbird app** reveals the app checkbox group
  (nginx, python, nodejs, postgresql, valkey, prometheus, grafana, cosign — the real
  `quay.io/hummingbird/*` catalog names).
- Ticking apps adds one commented line per app to the Containerfile preview, e.g. checking
  **nginx** and **nodejs** yields `# nginx  -> quay.io/hummingbird/nginx:latest` and
  `# nodejs -> quay.io/hummingbird/nodejs:latest`.
- Switching Hardened back to **None** hides the group and clears the app selection.

### Why the verdict is derived, not hand-written

`evaluateStack()` does **not** probe registries or the network at runtime — the spike
established that the answer (which bases can install ROS/sim) is stable and that the
bootc/Hummingbird extensions expose no queryable API (see "Why the wizard's layer lists
aren't queried live" above). But the verdict is also no longer a bag of ad-hoc
per-combination `if`s. Each base OS declares its **capabilities** as data
(`isBootc`, `packaging`, `requiresSubscription`, `supportsRos`, `supportsSim`,
`hasRosRepo`), and the verdict is *derived* from those facts in three ordered concerns:

1. **Build-feasibility** — a selected layer the base can't satisfy (ROS/sim on a base
   whose `supportsRos`/`supportsSim` is false, or sim with no ROS beneath it) → a
   `blocked` error naming the failing step.
2. **Advisories** — independent facts like the RHEL subscription requirement or the
   Hummingbird side-component note.
3. **Image classification** — for a build that *would* succeed: no ROS layer → ⚠️ "not a
   robotics image yet"; a supported robotics stack → ✅ "known-good".

Because step 3 is exhaustive over buildable selections, **every** combination resolves to
a coherent, complete verdict — which is what closed the Row-5/9 gap that the earlier
rule set missed. Flipping one capability fact (e.g. if upstream ever ships el9 ROS sim
RPMs) updates the whole matrix consistently, with no per-row rule to hunt down. A future
enhancement can decorate this static model with **local image availability**
(`listLocalImages()`) — the one genuinely-runtime signal that's feasible — without
changing the derivation.

## Follow-ups

- Revisit S8-14's NO-GO the same way APPENG-5809 is revisited: on a concrete trigger
  (official ROS Fedora/el9 simulation packages appear, a signed/TLS-correct
  `packages.ros.org` el9 repo, or a deliberate RHEL/UBI strategy) — not on a vague
  "when packaging matures" timeline.
- If a secure base ever does become viable, `SimulationBaseImages.ts`'s
  `SIMULATION_BASE_IMAGES` presets are data-driven and keyed by `distro`; a
  "secure/variant" discriminator field would be needed for a new preset to slot in
  cleanly (noted originally against S8-14 in the Story 8 tracking doc).
- Conda-forge/RoboStack was not prototyped; if source-of-truth packaging stays blocked
  for a long time, it's the more promising of the two non-native alternatives to
  revisit (avoids a from-source maintenance burden).
- User testing + merge of `feature/APPENG-6108-secure-base-spike` to `main` is still
  outstanding; do not treat Batch F as Closed until that happens.
