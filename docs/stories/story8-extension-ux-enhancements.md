# Story 8 — Extension UX Enhancements & Configurability

> **Jira:** Story **APPENG-6102** (under epic **APPENG-5763**), with one sub-task per batch:
> A **APPENG-6103** · B **APPENG-6104** · C **APPENG-6105** · D **APPENG-6106** ·
> E **APPENG-6107** · F **APPENG-6108**. These items were noticed during dogfooding of the
> extension (Image Builder, Simulation → OpenShift, robot spawn/Nav2).
>
> **Branches:** one per sub-task/batch, named after its Jira key — Batch A on
> `feature/APPENG-6103-quick-ui-wins`, Batch B on `feature/APPENG-6104-build-push-observability`,
> Batch C on `feature/APPENG-6105-openshift-config-safety`, later batches on
> `feature/APPENG-6106-…`, etc. Each is based independently off `main` (no stacking on a
> sibling batch branch, even when batches touch the same file) — this doc itself lives
> on `main` (not any one batch branch) so every batch can read and update it without
> depending on another batch's branch.
>
> **Status:** in progress. **Batches A, B and C are all merged to `main`** (2026-08-21) with
> merge commits, full suite green on the integrated `main` (397 unit + 23 script tests, 0
> failures). **Batch A (S8-1…S8-5)**, **Batch B (S8-6…S8-9)** and
> **Batch C (S8-10, S8-11, S8-16, S8-17)** are all done and user-verified in the running
> extension. Next up per the suggested order: **Batch D** (S8-12 SIM-only build path). Two
> small follow-ups (S8-19, S8-20) are deferred to a single direct-to-`main` cleanup commit —
> see Housekeeping; S8-18 (APPENG-6149) is a larger follow-up feature with its own branch.

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

### Batch C — OpenShift configurability & safety — APPENG-6105 ✅ Done

| Status | ID | Summary | Description | Files |
|--------|-----|---------|-------------|-------|
| ✅ | S8-C0 | Namespace configurable | **Done** on `feature/APPENG-6083-vgl-gpu-gui`: the deploy namespace seeds from the current kube context and is editable. (Baseline for S8-10.) | `OpenShiftDeploy.ts`, `api-impl.ts`, `OpenShiftSimulation.svelte` |
| ✅ | S8-10 | Cluster URL override | Cluster card's "Cluster URL" field is a **dropdown of every context in the kubeconfig** (not just current-context), shown by cluster server URL — since we can't invent credentials for an arbitrary typed URL, switching to a cluster the kubeconfig already has a context+credentials for is the only way to make this a real override rather than display-only. Switching re-targets **deploy and every cluster operation** (list/delete/spawn/navigate/despawn/robot-reconcile/login-check) to the selected context via `oc --context <name>` / `kubernetes.createResources(context, …)`, and re-seeds namespace + login status for the new cluster. New `listKubeContexts()` backend method (built on a `kubeconfigListEntryNames` helper shared with the existing single-context parsers); `context?: string` threaded through `OpenShiftDeployConfig`, `ExecTarget`, and every `oc`-invoking method. (Originally shipped as display-only; corrected after live testing showed that wasn't actually useful — the point was always to reach a cluster other than the kubeconfig default.) | `OpenShiftDeploy.ts`, `api-impl.ts` (`listKubeContexts`, `kubeconfigListEntryNames`, every OpenShift method), `PhysicalAiApi.ts`, `OpenShiftSimulation.svelte` (Cluster card dropdown) |
| ✅ | S8-11 | `oc whoami` pre-check | New `checkOpenShiftLogin()` backend method (`oc whoami`, reuses the existing `#ocErrorMessage` CLI-missing detection) called on mount alongside `getOpenShiftContext`; gates the existing `canDeploy` check and the Robots panel, with a clear "not logged in" banner instead of a failed deploy. | `api-impl.ts` (`checkOpenShiftLogin`), `PhysicalAiApi.ts`, `OpenShiftSimulation.svelte` |
| ✅ | S8-16 | Default namespace via extension setting | Added a **new**, dedicated setting `physical-ai.defaultOpenShiftNamespace` (separate from the Quay-purposed `physical-ai.defaultNamespace`) and a `getDefaultOpenShiftNamespace()` backend method. `OpenShiftSimulation.svelte`'s `onMount` now falls back to it only when the kube context sets no namespace — the context's own namespace, when present, always still wins; unconfigured means `''`, never a silent `'default'`. | `package.json` (contributes.configuration), `api-impl.ts` (`getDefaultOpenShiftNamespace`), `PhysicalAiApi.ts`, `OpenShiftSimulation.svelte` |
| ✅ | S8-17 | Reflect already-spawned robots | New `listSpawnedRobotsInOpenShift()` backend method runs `ros2 node list` in the pod and extracts robot names from namespaced nodes (`/robot_1/...`). `refreshWorkloads()` reconciles each ready workload's robot list against it **once** (guarded by a `reconciledWorkloads` set, cleared on delete/vanish so a redeploy reconciles fresh) — only ever appending missing entries, never overwriting live `navStatus`/`navTarget`. Reconciled robots get a placeholder `x`/`y` (`'?'`, not recoverable from `ros2 node list` alone) and pick up `warmStatus` via the existing 3s `pollWarmStatus` loop with no extra wiring. | `api-impl.ts` (`listSpawnedRobotsInOpenShift`), `PhysicalAiApi.ts`, `OpenShiftSimulation.svelte` (`refreshWorkloads`, `reconcileRobots`) |
| ⚪ | S8-18 | Prune stale robot entries | **Found during APPENG-6148 testing (2026-08-20):** a pod crashed/restarted mid-spawn (Path B always resets to an empty world), but the UI kept showing the robot as spawned — "Nav2 warming…" → "Nav2 warm-up failed" → Navigate "Failed" — since nothing told it the spawn attempt died with the pod. Confirmed zero ROS nodes/topics/Gazebo models actually existed. S8-17 only handles the ADD direction (by design — "only ever appends missing entries, never removes"); this is the missing REMOVE/prune direction: detect a previously-tracked robot no longer present in the actual world and drop it. APPENG-6149. | `OpenShiftSimulation.svelte` (`refreshWorkloads`, `robotsByWorkload`), `api-impl.ts` (`listSpawnedRobotsInOpenShift`) |
| ⚪ | S8-19 | Fix duplicate robot-name suggestion | **Found alongside S8-18** — screenshot showed `robot_1` listed twice (the Name field's suggested value *and* an already-tracked entry). Root cause: `RobotControls.svelte`'s `form.name` is seeded once from the static `initialName` prop at mount; the dedup logic (`nextFreeName()`) only reruns after a spawn *in the same session* — never against `robots` at mount or on later updates (e.g. after S8-17/S8-18 reconciliation). Make the suggested name reactive to the current `robots` array. (A spawn-time guard already blocks creating a real duplicate; this is only the misleading pre-filled name.) APPENG-6150. | `RobotControls.svelte` (`form`, `nextFreeName`, `startCounter`) |
| ⚪ | S8-20 | Space out resource/namespace in deploy banner | **Found during Batch C verification (2026-08-21):** the S8-4 success banner renders the flat backend `deployResult.message` ("Deployed ros2-jazzy-sim to sgahlot-pd-extn") so the resource name, "to" and namespace run together and the "to" is easy to miss. `deployResult` already carries `name`/`namespace` separately — render them as distinct emphasized `font-mono` spans instead of the flat message string. Not yet filed (tracked here). | `OpenShiftSimulation.svelte` (deploy banner ~537) |
| ⚪ | S8-21 | Filterable namespace/project picker | **Requested 2026-08-21:** the Project/namespace field is a free-text input seeded from the kube context / `physical-ai.defaultOpenShiftNamespace` setting (S8-16). Typing the namespace by hand is error-prone (got it wrong more than once). Keep showing the default namespace, but let the user **pick** from all available projects rather than typing it blind: a type-to-filter combobox that lists every project the user can see (`oc get projects`) for the currently-targeted (possibly context-overridden, per S8-10) cluster, and filters the list as you type. Still allows the default and honours a context override. Mirrors the S8-10 cluster-URL dropdown pattern. Not yet filed. | `api-impl.ts` (new `listOpenShiftProjects`), `PhysicalAiApi.ts`, `OpenShiftSimulation.svelte` (Project/namespace field) |

> **Deferred cleanup (S8-19 + S8-20):** both are small, cosmetic, and only became relevant
> once Batch A's banner + `RobotControls` reached `main` — which happened with the 2026-08-21
> A/B/C merges. They'll land together as one small **direct-to-`main`** commit (no feature
> branch). S8-18 (APPENG-6149, prune stale robots) and S8-21 (filterable namespace picker) are separate real features that each get their own branch — not part of this cleanup commit.

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
- ✅ **"Nav2 warming…" indicator is easy to miss** — **done in Batch A** (commit `247c815`):
  it's now a rounded accent pill (larger pulsing dot + `text-sm font-medium` in
  `RobotControls.svelte`), no longer same-weight inline text.

---

## Suggested order

1. **Batch A** (S8-1…S8-5) — quick wins, no GPU. ✅ done (`feature/APPENG-6103-quick-ui-wins`)
2. **Batch B** (S8-6…S8-9) — build/push observability. ✅ done (`feature/APPENG-6104-build-push-observability`)
3. **Batch C** (S8-10 cluster URL, S8-11 `oc whoami`, S8-16 default-namespace setting, S8-17 reflect already-spawned robots). ✅ done (`feature/APPENG-6105-openshift-config-safety`)
4. **Batch D** (S8-12) — SIM-only build path. ← next
5. **Batch E** (S8-13) — layout config (prototype variants first).
6. **Batch F** (S8-14 spike → S8-15 wizard) — secure layers, then the full wizard.

---

_Related: [Story 1 (Image Builder / base images)](../podman-extension-plan.md#story-1),
[Story 4 (OpenShift bridge)](story4-openshift-bridge.md),
[Story 7 (multi-pod OpenShift)](story7-multipod-openshift-architecture.md)._
