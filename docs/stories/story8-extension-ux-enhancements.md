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
> **Status:** in progress. **Batches A, B, C and D are all merged to `main`** (2026-08-21) with
> merge commits, full suite green on the integrated `main` (408 unit + 23 script tests, 0
> failures). **Batch A (S8-1…S8-5)**, **Batch B (S8-6…S8-9)**,
> **Batch C (S8-10, S8-11, S8-16, S8-17)** and **Batch D (S8-12)** are all done and
> user-verified in the running extension. The S8-19 + S8-20 cleanup (plus an
> S8-17 `(?, ?)` refinement) landed direct-to-`main` on 2026-08-21. **S8-21** (filterable
> namespace picker, APPENG-6156) is done and merged to `main` (2026-08-21) on
> `feature/APPENG-6156-namespace-picker`. Next up per the suggested order: **Batch E**
> (S8-13 layout config). S8-18 (APPENG-6149, prune stale robots) is another follow-up
> feature with its own branch.

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
| ⚪ | S8-22 | Rethink "Last/Previous build" log labeling (logs don't persist) | **Found during Batch A–C re-test (2026-08-21):** S8-6's "Last build" / "Previous build" label has little real value as shipped. (1) It shows **"Last build" immediately after a build completes** — but that's the just-finished/current build, not a prior one. (2) **Navigating away from the Image Builder page and back clears the logs entirely** — they live only in `BuildPushPanel` component state and reset on mount, so a genuine "previous build" from an earlier visit is never shown. (3) The label only ever attaches to Phase 1 logs in the same session; Phase 2 shows no previous build. Net: the label only appears right after a completed build in the same session, which is misleading. **Needs a decision:** either persist build logs + metadata across navigation (so "Last build" reflects a real prior build) or drop the stale-label concept entirely. Not yet filed. | `BuildPushPanel.svelte` (logs state ~47/367-379, reset ~261-281, label rendering) |

<a id="s8-ocp-config"></a>

### Batch C — OpenShift configurability & safety — APPENG-6105 ✅ Done

| Status | ID | Summary | Description | Files |
|--------|-----|---------|-------------|-------|
| ✅ | S8-C0 | Namespace configurable | **Done** on `feature/APPENG-6083-vgl-gpu-gui`: the deploy namespace seeds from the current kube context and is editable. (Baseline for S8-10.) | `OpenShiftDeploy.ts`, `api-impl.ts`, `OpenShiftSimulation.svelte` |
| ✅ | S8-10 | Cluster URL override | Cluster card's "Cluster URL" field is a **dropdown of every context in the kubeconfig** (not just current-context), shown by cluster server URL — since we can't invent credentials for an arbitrary typed URL, switching to a cluster the kubeconfig already has a context+credentials for is the only way to make this a real override rather than display-only. Switching re-targets **deploy and every cluster operation** (list/delete/spawn/navigate/despawn/robot-reconcile/login-check) to the selected context via `oc --context <name>` / `kubernetes.createResources(context, …)`, and re-seeds namespace + login status for the new cluster. New `listKubeContexts()` backend method (built on a `kubeconfigListEntryNames` helper shared with the existing single-context parsers); `context?: string` threaded through `OpenShiftDeployConfig`, `ExecTarget`, and every `oc`-invoking method. (Originally shipped as display-only; corrected after live testing showed that wasn't actually useful — the point was always to reach a cluster other than the kubeconfig default.) | `OpenShiftDeploy.ts`, `api-impl.ts` (`listKubeContexts`, `kubeconfigListEntryNames`, every OpenShift method), `PhysicalAiApi.ts`, `OpenShiftSimulation.svelte` (Cluster card dropdown) |
| ✅ | S8-11 | `oc whoami` pre-check | New `checkOpenShiftLogin()` backend method (`oc whoami`, reuses the existing `#ocErrorMessage` CLI-missing detection) called on mount alongside `getOpenShiftContext`; gates the existing `canDeploy` check and the Robots panel, with a clear "not logged in" banner instead of a failed deploy. | `api-impl.ts` (`checkOpenShiftLogin`), `PhysicalAiApi.ts`, `OpenShiftSimulation.svelte` |
| ✅ | S8-16 | Default namespace via extension setting | Added a **new**, dedicated setting `physical-ai.defaultOpenShiftNamespace` (separate from the Quay-purposed `physical-ai.defaultNamespace`) and a `getDefaultOpenShiftNamespace()` backend method. `OpenShiftSimulation.svelte`'s `onMount` now falls back to it only when the kube context sets no namespace — the context's own namespace, when present, always still wins; unconfigured means `''`, never a silent `'default'`. | `package.json` (contributes.configuration), `api-impl.ts` (`getDefaultOpenShiftNamespace`), `PhysicalAiApi.ts`, `OpenShiftSimulation.svelte` |
| ✅ | S8-17 | Reflect already-spawned robots | New `listSpawnedRobotsInOpenShift()` backend method runs `ros2 node list` in the pod and extracts robot names from namespaced nodes (`/robot_1/...`). `refreshWorkloads()` reconciles each ready workload's robot list against it **once** (guarded by a `reconciledWorkloads` set, cleared on delete/vanish so a redeploy reconciles fresh) — only ever appending missing entries, never overwriting live `navStatus`/`navTarget`. Reconciled robots pick up `warmStatus` via the existing 3s `pollWarmStatus` loop with no extra wiring. **Refinement (2026-08-21, direct-to-`main` cleanup):** their spawn position isn't recoverable from `ros2 node list`, so instead of a `'?'` placeholder the coords are now *omitted* — `RobotEntry.x`/`y` are optional and the row shows just the robot name (no meaningless "spawned at (?, ?)"). Locally-spawned robots still show their real coordinates. | `api-impl.ts` (`listSpawnedRobotsInOpenShift`), `PhysicalAiApi.ts`, `OpenShiftSimulation.svelte` (`refreshWorkloads`, `reconcileRobots`), `RobotControls.svelte`, `RobotControls.types.ts` |
| ⚪ | S8-18 | Prune stale robot entries | **Found during APPENG-6148 testing (2026-08-20):** a pod crashed/restarted mid-spawn (Path B always resets to an empty world), but the UI kept showing the robot as spawned — "Nav2 warming…" → "Nav2 warm-up failed" → Navigate "Failed" — since nothing told it the spawn attempt died with the pod. Confirmed zero ROS nodes/topics/Gazebo models actually existed. S8-17 only handles the ADD direction (by design — "only ever appends missing entries, never removes"); this is the missing REMOVE/prune direction: detect a previously-tracked robot no longer present in the actual world and drop it. APPENG-6149. | `OpenShiftSimulation.svelte` (`refreshWorkloads`, `robotsByWorkload`), `api-impl.ts` (`listSpawnedRobotsInOpenShift`) |
| ✅ | S8-19 | Fix duplicate robot-name suggestion | **Done** (APPENG-6150). Added a pure `suggestedName(robots)` helper and a `$: if (!nameEdited) form.name = suggestedName(robots)` reactive statement so the pre-filled Name always reflects the next free `robot_N` against the *live* `robots` list (at mount and on later changes, e.g. S8-17/S8-18 reconciliation) — unless the user has typed their own name (`nameEdited` flag, reset after a spawn). The spawn-time duplicate guard is untouched; this only fixes the misleading pre-fill. Spec updated to force the duplicate via user input instead of relying on the old stale pre-fill. | `RobotControls.svelte` (`suggestedName`, `nameEdited`, `$:`), `RobotControls.spec.ts` |
| ✅ | S8-20 | Space out resource/namespace in deploy banner | **Done.** The flat-message concern was already resolved by the earlier `DeployOpenShift`→`OpenShiftSimulation` consolidation (commit `2ad39ee5`), which renders `deployResult.name`/`.namespace` as separate `font-mono` spans. This item added the emphasis the user asked for: the resource name now uses the strong header color and the namespace the accent color, both `font-semibold`, so they stand out as distinct values rather than a run-on phrase. | `OpenShiftSimulation.svelte` (deploy banner ~549) |
| ✅ | S8-21 | Filterable namespace/project picker | **Done** (APPENG-6156). The Project/namespace field is now a type-to-filter combobox: new `listOpenShiftProjects()` backend method (`oc get projects -o name`, prefix-stripped + sorted, fails soft to `[]`) feeds a custom Svelte dropdown that lists every project the user can see on the currently-targeted (possibly context-overridden, per S8-10) cluster and filters as you type. A native `<input list>`/`<datalist>` renders misaligned with an uncontrollable height in the PD/Electron webview, so the menu is a positioned, height-capped (`max-h-60`, scrollable) listbox with keyboard nav (Arrow/Enter/Escape), a11y roles, and a discoverability hint. Refreshes on mount and on cluster switch. **System/default namespaces** (`default`, `openshift`, `openshift-*`, `kube-*`) are hidden from suggestions by default to cut noise, revealed by a **"Show system projects"** checkbox that only appears when the cluster actually has some. Free-text entry still reaches any namespace (honours the default + a context override). | `api-impl.ts` (`listOpenShiftProjects`), `PhysicalAiApi.ts`, `OpenShiftSimulation.svelte` (Project/namespace combobox + system-project toggle) |

> **Deferred cleanup (S8-19 + S8-20) — ✅ landed 2026-08-21** as one small **direct-to-`main`**
> commit (no feature branch), together with the S8-17 `(?, ?)` refinement above. All three were
> user-verified in the running extension before the commit. S8-18 (APPENG-6149, prune stale
> robots) and S8-21 (filterable namespace picker) remain separate real features that each get
> their own branch — not part of this cleanup commit.

<a id="s8-quickstart"></a>

### Batch D — Image Builder flow — APPENG-6106 ✅ Done

| Status | ID | Summary | Description | Files |
|--------|-----|---------|-------------|-------|
| ✅ | S8-12 | Build only the SIM image without full Quick Start | **Done** — the Image Builder was reworked so the SIM image no longer requires re-running Quick Start. The old two Quick Start cards + separate Phase 1/Phase 2 became a single unified pipeline: a first-class **Target** arch toggle (this machine vs amd64-for-OpenShift), one Quick Start button (with an overwrite-confirmation when the current config differs from the preset), and a reactive base/SIM image-existence check (keyed on `${baseTag}\|${simTag}`) that unlocks the SIM build the moment the base exists — no Quick Start needed. Also added: build-log timestamps rendered in the **host local timezone** (was UTC), and a selectable **layout** (`physical-ai.imageBuilderLayout` preference — `guided` default / `pipeline`) with an in-page switcher; the guided layout leads with a "what do you want to build?" chooser (base only / simulation / both) and reveals only the relevant build panel(s), reusing the same base-existence gating. Panel heading is context-aware ("Guided Image Builder" vs "Image Builder Pipeline"). | `SimulationSetup.svelte`, `SimulationSetup.spec.ts`, `progressLogs.ts`, `progressLogs.spec.ts`, `PhysicalAiApi.ts`, `api-impl.ts`, `backend/package.json` |

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
4. **Batch D** (S8-12) — SIM-only build path. ✅ done (`feature/APPENG-6106-sim-only-build`)
5. **Batch E** (S8-13) — layout config (prototype variants first). ← next
6. **Batch F** (S8-14 spike → S8-15 wizard) — secure layers, then the full wizard.

---

_Related: [Story 1 (Image Builder / base images)](../podman-extension-plan.md#story-1),
[Story 4 (OpenShift bridge)](story4-openshift-bridge.md),
[Story 7 (multi-pod OpenShift)](story7-multipod-openshift-architecture.md)._
