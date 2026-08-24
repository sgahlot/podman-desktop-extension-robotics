# APPENG-6108 (Story 8, Batch F) — Secure base spike: S8-14 → S8-15

**Status:** S8-14 (feasibility spike) **done — verdict NO-GO natively today**. S8-15
(layer-composition wizard) **prototype code-complete** on
`feature/APPENG-6108-secure-base-spike` (commits `4e608f6`, `528a6df`) — awaiting user
testing + merge to `main`. See
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
+ `'layers'` mode plumbing), `528a6df` (wizard UI, prototype). **Not yet merged to
`main`** — awaiting user testing before merge, per this project's zero-errors-on-merge /
merge-to-main-before-Closed workflow.

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
