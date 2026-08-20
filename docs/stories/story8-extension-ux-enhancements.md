# Story 8 — Extension UX Enhancements & Configurability

> **Jira:** Story **APPENG-6102** (under epic **APPENG-5763**), with one sub-task per batch:
> A **APPENG-6103** · B **APPENG-6104** · C **APPENG-6105** · D **APPENG-6106** ·
> E **APPENG-6107** · F **APPENG-6108**. These items were noticed during dogfooding of the
> extension (Image Builder, Simulation → OpenShift, robot spawn/Nav2).
>
> **Branches:** one per sub-task/batch, named after its Jira key — Batch A on
> `feature/APPENG-6103-quick-ui-wins`, Batch B on `feature/APPENG-6104-build-push-observability`,
> later batches on `feature/APPENG-6105-…`, etc. Each is based independently off `main`
> (no stacking on a sibling batch branch, even when batches touch the same file) —
> this doc itself lives on `main` (not any one batch branch) so every batch can read
> and update it without depending on another batch's branch.
>
> **Status:** in progress. **Batch A (S8-1…S8-5) done** — `feature/APPENG-6103-quick-ui-wins`,
> frontend suite 88/88 green, user-verified. **Batch B (S8-6…S8-9) done** —
> `feature/APPENG-6104-build-push-observability`, user-verified in the running extension.
> Next up per the suggested order: **Batch C** (S8-10 cluster URL, S8-11 `oc whoami`,
> S8-16 default-namespace setting, S8-17 reflect already-spawned robots).

---

## Overview

A grab-bag of UX polish, feedback/observability, and configurability improvements for the
extension, plus two larger forward-looking features (a **layout config option** and a
**project wizard** for image layers / worlds / robots). Grouped below into batches so we
can land the low-risk wins first and design the bigger features deliberately.

**Legend:** ✅ Done · 🟠 In Review · 🟡 In Progress · ⚪ Not Started · 🅿️ Parked · 💡 Design/vision

---

## Decisions (2026-08-19)

| Topic | Decision |
|-------|----------|
| **First pick-up** | Quick UI wins (S8-1…S8-5) — no GPU, locally testable. |
| **Layout** | Build a **full config option**: user picks Sidebar / Horizontal tabs / Cards via a preference; net-new persistent nav shell wrapping `<main>`. |
| **Secure base images** | **Near-term:** feasibility spike only — can ROS 2 Jazzy layer onto hummingbird / bootc at all? **Ultimate:** a project wizard to choose image *layers* (reuse the bootc/hummingbird extensions if installed, else pull upstream images) + *worlds* + *robots*. |
| **OCP cluster** | Seed the cluster from the kubeconfig context (default shown), but let the user **override with a full cluster URL** — same editable-field pattern as the namespace. |
| **Jira** | None yet; track here and promote to APPENG-5763 sub-tasks as picked up. |

---

## Work Breakdown

<a id="s8-quick-wins"></a>

### Batch A — Quick UI wins (first pick-up) — APPENG-6103 ✅ Done

Small, localized, GPU-free. Mostly `OpenShiftSimulation.svelte` + `RobotControls.svelte`.

| Status | ID | Summary | Description | Files |
|--------|-----|---------|-------------|-------|
| ✅ | S8-1 | Deploy in-progress status | Deploy gives no clear in-progress feedback — the button flips to "Deploying…" (`OpenShiftSimulation.svelte:378`) but there's no banner/spinner, and success only appears as green text. Add a visible in-progress indicator (banner or spinner near the result area). | `OpenShiftSimulation.svelte` (deploy flow 139-152, result banner 389-399) |
| ✅ | S8-2 | Remove button during "Nav2 warming…" | Robots can get stuck in `warmStatus === 'warming'`; today the **Remove** button is nested in the `{:else}` of the warming check (`RobotControls.svelte:158/167`) so it's absent during warm-up. Lift Remove (and the name/warm badge) out of that conditional; keep only the nav inputs/Navigate gated on warming. | `RobotControls.svelte` (153-217) |
| ✅ | S8-3 | Drop duplicate route link in deploy banner | The success banner shows an "Open \<route\>" link (`OpenShiftSimulation.svelte:393-396`) that's redundant with the same link in the Deployed simulations list. Remove it from the banner. | `OpenShiftSimulation.svelte:389-399` |
| ✅ | S8-4 | Format the deploy result banner | Restructure the banner into three clear lines: **Deployed to …** / **Route …** / **Applied …** (currently one message blob + applied kinds). | `OpenShiftSimulation.svelte:389-399` |
| ✅ | S8-5 | Show route link only when actually reachable | The "Open \<route\>" link in the Deployed simulations list appears even when the pod is `0/1 ready` (`{#if w.routeUrl}` at `OpenShiftSimulation.svelte:458`). Gate it on the route being truly usable (pod ready **and** route admitted), otherwise keep the "Route not admitted yet." hint. | `OpenShiftSimulation.svelte:458-466` (uses `w.ready`, `w.routeUrl`) |

<a id="s8-build-ux"></a>

### Batch B — Build/push observability — APPENG-6104 ✅ Done

Needed backend type additions (`BuildProgress`/`PushProgress` in
`shared/src/types/ImageCatalog.ts` had no timestamp/duration fields).

| Status | ID | Summary | Description | Files |
|--------|-----|---------|-------------|-------|
| ✅ | S8-6 | Label stale/previous build logs | When the panel shows logs from a prior build, label them "Last build" / "Previous build" so it's clear they're not live. Logs currently live only in `BuildPushPanel` state and clear on mount. | `BuildPushPanel.svelte` (logs 47/367-379, reset 261-281) |
| ✅ | S8-7 | Timestamp build output | Capture a timestamp per log line (or per step) at ingestion (`api-impl.ts:#startImageBuild` stream handler ~358-368) and render it. | `api-impl.ts`, `progressLogs.ts`, `ImageCatalog.ts`, `BuildPushPanel.svelte` |
| ✅ | S8-8 | Show build/push duration | Add `startedAt`/`finishedAt` to `BuildProgress`/`PushProgress`, set them in the backend, and show "Built in Xs / Pushed in Ys" on completion. | `ImageCatalog.ts`, `api-impl.ts` (329-435 build, push), `BuildPushPanel.svelte` |
| ✅ | S8-9 | Collapsible Image Builder sections | Make the options block, Phase 1, and Phase 2 collapsible on the Image Builder page to reduce scroll. | `SimulationSetup.svelte` (options 189-303, Phase 1 337-362, Phase 2 366-397) |

<a id="s8-ocp-config"></a>

### Batch C — OpenShift configurability & safety — APPENG-6105

| Status | ID | Summary | Description | Files |
|--------|-----|---------|-------------|-------|
| ✅ | S8-C0 | Namespace configurable | **Done** on `feature/APPENG-6083-vgl-gpu-gui`: the deploy namespace seeds from the current kube context and is editable. (Baseline for S8-10.) | `OpenShiftDeploy.ts`, `api-impl.ts`, `OpenShiftSimulation.svelte` |
| ⚪ | S8-10 | Cluster URL override | Show the current cluster server URL (from kubeconfig / `oc whoami --show-server`) as the default and let the user override it with a full cluster URL — same editable pattern as the namespace. Add a `server` field to `OpenShiftContext`, parse it in `getOpenShiftContext`, surface it in the Cluster card + as an editable field, and target it on deploy. | `OpenShiftDeploy.ts` (53-62), `api-impl.ts` (`getOpenShiftContext` 1601-1618), `OpenShiftSimulation.svelte` (context card 280-293) |
| ⚪ | S8-11 | `oc whoami` pre-check | Before enabling deploy/spawn on the OpenShift tab, run and verify `oc whoami` (greenfield — no `oc whoami` plumbing exists) so we fail early with a clear "not logged in" message instead of a failed deploy. | `api-impl.ts` (follow `process.exec('oc', …)` pattern ~1652), `OpenShiftSimulation.svelte` |
| ⚪ | S8-16 | Default namespace via extension setting | The deploy namespace still falls back to `default` when the kube context carries no namespace, so the workloads list shows "no deployments in this namespace" until the user types the right one. Add an extension **setting** for the default namespace: keep reading the kubeconfig context, but use the configured setting as the default value when the context has none (setting overrides the `default` fallback, not an explicit context namespace). | Preferences/settings, `api-impl.ts` (`getOpenShiftContext` / `getDefaultNamespace`), `OpenShiftSimulation.svelte` |
| ⚪ | S8-17 | Reflect already-spawned robots | After a pod restart or an extension reload, the UI forgets robots spawned earlier (e.g. `robot_1`) — spawn/warm state lives only in frontend memory. Reconcile on load/refresh by detecting robots actually present in the running sim (ROS graph / `gz model --list` or topic probe) and render them with their real warm state, instead of assuming none. | `OpenShiftSimulation.svelte`, `RobotControls.svelte`, `api-impl.ts` (new "list spawned robots" probe) |

<a id="s8-quickstart"></a>

### Batch D — Image Builder flow — APPENG-6106

| Status | ID | Summary | Description | Files |
|--------|-----|---------|-------------|-------|
| ⚪ | S8-12 | Build only the SIM image without full Quick Start | Today you must click **Quick Start** (Local/OCP) to configure the right image even if you only want the Phase 2 SIM image. `applyQuickStart` (`SimulationSetup.svelte:125-137`) hard-sets robot/distro/middleware/engine/base + arch. Provide an alternative path to configure/build+push just the SIM image (Phase 2) without re-running the whole Quick Start. | `SimulationSetup.svelte` (Quick Start 155-187, Phase 2 366-397) |

<a id="s8-layout"></a>

### Batch E — Layout config (larger) — APPENG-6107

| Status | ID | Summary | Description | Files |
|--------|-----|---------|-------------|-------|
| ⚪ | S8-13 | Selectable navigation layout | A preference to switch the shell between **Sidebar**, **Horizontal tabs**, and **Cards** (current). Net-new: a persistent nav component wrapping `<main>` (App.svelte), a persisted setting, and keeping the routes (App.svelte:28-47) working under each layout. Reference the bootc "Bootable Containers" and Hummingbird extensions' sidebar navigation for the sidebar variant. | `App.svelte`, `Dashboard.svelte` (cards 44-93), new nav component, Preferences |

> **Approach:** prototyping the sidebar + horizontal-tabs variants first (to eyeball
> them) is a sensible sub-step even though the end goal is the full 3-way config.

<a id="s8-wizard"></a>

### Batch F — Secure base images → project wizard (design/vision) — APPENG-6108

| Status | ID | Summary | Description |
|--------|-----|---------|-------------|
| ⚪ | S8-14 | Feasibility spike: ROS 2 on hummingbird / bootc | **Near-term.** Can ROS 2 Jazzy (full apt/dnf base) layer onto a hardened, minimal **hummingbird** runtime image or a **bootc** bootable image at all? Write up findings + a go/no-go. Base presets are data-driven (`SimulationBaseImages.ts:SIMULATION_BASE_IMAGES`), so if feasible a new preset auto-appears in the base dropdown — but presets are keyed by `distro` only, so a "secure/variant" discriminator field would be needed. |
| 💡 | S8-15 | Project wizard: layers + worlds + robots | **Ultimate vision.** A guided wizard to compose a build from: (1) **image layers** — let the user choose secure base layers (bootc/hummingbird); reuse those extensions if installed, else pull the images from upstream; (2) **worlds** — pick a Gazebo world beyond the default; (3) **robots** — pick robot type(s) beyond TurtleBot3. Supersedes the current fixed Quick Start / single-world / single-robot flow. Design-only for now. |

---

## Housekeeping (discovered while mapping)

- **Stray NUL byte in `backend/src/api-impl.ts`** (~offset 49007) makes plain
  `grep`/`cat` treat the file as binary and silently return nothing (use `rg --text`
  or the editor's read). Worth stripping in a small cleanup commit — it has bitten
  tooling more than once.

---

## Suggested order

1. **Batch A** (S8-1…S8-5) — quick wins, no GPU. ✅ done (`feature/APPENG-6103-quick-ui-wins`)
2. **Batch B** (S8-6…S8-9) — build/push observability. ✅ done (`feature/APPENG-6104-build-push-observability`)
3. **Batch C** (S8-10 cluster URL, S8-11 `oc whoami`, S8-16 default-namespace setting, S8-17 reflect already-spawned robots) — builds on the namespace work. ← next
4. **Batch D** (S8-12) — SIM-only build path.
5. **Batch E** (S8-13) — layout config (prototype variants first).
6. **Batch F** (S8-14 spike → S8-15 wizard) — secure layers, then the full wizard.

---

_Related: [Story 1 (Image Builder / base images)](../podman-extension-plan.md#story-1),
[Story 4 (OpenShift bridge)](story4-openshift-bridge.md),
[Story 7 (multi-pod OpenShift)](story7-multipod-openshift-architecture.md)._
