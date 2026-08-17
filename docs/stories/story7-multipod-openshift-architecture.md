# Story 7 — Multi-Pod OpenShift Architecture (design)

**Jira:** APPENG-5777 (parent) | **Branch:** `feature/APPENG-5777-openshift-deploy`
**Status:** design / not started. Forward-looking — captures the strategy so the
CPU/thread work (Story 5) and future robot scaling land in a coherent shape.

This is the **OpenShift counterpart** to [Story 3](story3-multi-robot.md)'s local
Podman-Compose fleet plan. Story 3 chose **Zenoh** for inter-container comms
(APPENG-5775); this doc reuses that decision on the cluster so the laptop and
cluster topologies stay aligned.

> **Sequencing decision (do OpenShift first).** We tackle multi-pod on
> **OpenShift first** — OCP has the node headroom to actually run multiple pods,
> so it's the fastest place to prove the topology (sim pod + Nav2-per-pod + zenoh
> router). Once it works on the cluster we **backport** the same shape to local
> Podman (Story 3 / APPENG-5774/5775/5776) and see what does and doesn't
> translate (multicast, shared memory, resource limits). Local multi-robot is
> therefore *deferred* behind this OpenShift work, not the other way around.

---

## Problem

The software-render sim runs as a **single pod, single container** requesting a
large guaranteed CPU slice (Story 5: 8 CPU). Two limits fall out of that:

1. **Scheduling ceiling.** An 8-CPU Guaranteed pod can only land on the 16-core
   worker nodes (the 8-core nodes expose ~7500m allocatable). On the current
   cluster only ~2 of 9 big nodes have room; the rest would push it to `Pending`.
   A single pod's request must fit on **one node** — you cannot spread it.
2. **Robot scaling.** Each robot's Nav2 stack adds ~1 core. A single pod holding
   the sim *plus* N Nav2 stacks grows into a monster (5 robots ≈ 12+ CPU) that
   fits nowhere.

**Only splitting work across pods lets the scheduler spread it across nodes.**
That same split is what makes many-robot scenes feasible.

<a id="multi-container-vs-multi-pod"></a>
## Multi-container ≠ multi-pod (the load-bearing distinction)

- **Multiple containers in one pod** → shared netns (localhost), a shared
  `/dev/shm` (emptyDir `medium: Memory`), optional `shareProcessNamespace`.
  Gazebo's shared-memory transport "just works" like today. Buys *modularity*
  and per-container limits — but the pod's request is the **sum** of its
  containers and still lands on **one node**. Does **not** relieve the
  scheduling ceiling.
- **Multiple pods** → separate netns; no shared memory; **multicast discovery is
  dropped by most CNIs**. Requires an explicit discovery mechanism (see Zenoh
  below). This is the **only** thing that spreads load across nodes.

<a id="what-to-split"></a>
## What to split — and what not to

Do **not** split Gazebo's own internals (gz-server ↔ gz-GUI) across pods. They
speak **gz-transport** (shared memory + multicast discovery); across pods that
forces unicast relays + partition config — high pain, low payoff.

Split along the seam that actually multiplies and that speaks a distributable
middleware:

| Component | CPU | Scales w/ robots? | Transport | Split out? |
|-----------|-----|-------------------|-----------|------------|
| Gazebo physics server | ~2–3 cores | grows (sensors) | gz-transport | No — keep with render |
| GUI render (llvmpipe) | ~2.3 cores | ~flat (scene) | gz-transport | No — keep with server |
| noVNC / Xvfb | ~0.3 core | flat | local | Optional sidecar |
| **Nav2 stack (per robot)** | **~1 core** | **linear** | **ROS 2 / DDS** | **Yes — one pod per robot** |

> **Rule:** keep the sim (physics + render + noVNC) as one pod; move each robot's
> **Nav2 stack** into its own pod. The part that multiplies is the part that
> speaks ROS 2 middleware, which distributes across pods cleanly.

5 robots then becomes **1 sim pod** (~4–6 CPU) + **5 small Nav2 pods** (~1 CPU
each) that fit on *any* node — instead of one 12-CPU pod that fits nowhere.

<a id="discovery"></a>
## Cross-pod discovery: rmw_zenoh (decided)

Default ROS 2 (Fast/Cyclone DDS) uses multicast discovery → broken across pods.
**Decision: rmw_zenoh** (aligns with Story 3 / APPENG-5775 and is the direction
Jazzy is heading; purpose-built for distributed/cloud ROS 2).

- A single **zenoh-router pod** fronted by a **Service** (stable DNS).
- Sim pod and every Nav2 pod run `rmw_zenoh_cpp` and point at the router via env
  (`RMW_IMPLEMENTATION=rmw_zenoh_cpp`, router endpoint config).
- Requires `rmw_zenoh` + the router baked into the image(s).

Fast DDS Discovery Server (`ROS_DISCOVERY_SERVER`) was the considered
alternative — proven but more manual per-pod wiring and less future-facing.
Rejected in favor of Zenoh for laptop/cluster parity.

<a id="helm"></a>
## Config surface: TS builder + exported Helm chart (decided)

One config object from the UI is the **single source of truth**. Two consumers:

1. **Extension apply path** — the typed, unit-tested `manifests.ts` builder
   *loops* over that config to emit the sim pod + N Nav2 pods + Zenoh pod/Service.
   No runtime `helm` dependency; keeps the tests.
2. **Exported artifact** — serialize the same config to a `values.yaml` and ship
   a **Helm chart** for users who deploy/customize/GitOps *outside* the
   extension. `values.yaml` documents the surface: CPU per component, robot
   count, GPU on/off, distro, discovery/router settings.

Helm's `range`-over-robots is a natural fit at Phase 2, but the extension itself
stays programmatic so it neither depends on the helm binary nor loses type safety.

<a id="phases"></a>
## Phased plan

- **Phase 0 — stabilize the single pod (✅ implemented; awaiting live-validate).**
  - Configurable software-render **CPU count** — `OpenShiftDeployConfig.cpu` +
    `manifests.ts` (`DEFAULT_SW_RENDER_CPU`, `assertCpuCount`) + a
    **Software-render CPUs** field on the OpenShift tab, so users dial it
    per-cluster without a rebuild.
  - **Image thread caps** — `entrypoint-gazebo.sh` caps
    `OMP_/OPENBLAS_/LP_/MESA_/GALLIUM_NUM_THREADS` to the cgroup quota (see
    [story5-image-thread-caps.md](story5-image-thread-caps.md)) so pools stop
    oversubscribing at any core count — lowers the CPU the sim needs and thus the
    bar multi-pod must clear. **Needs the user's image rebuild + push.**
- **Phase 1 — multi-container sim pod (optional stepping stone).**
  Split noVNC/render from physics as sidecars sharing `/dev/shm`. Modularity +
  clean per-container limits, no cross-pod networking yet.
- **Phase 2 — Nav2-per-pod + Zenoh router (the real win).**
  Sim stays one pod; each robot's Nav2 stack becomes its own pod; a zenoh-router
  pod + Service wires them. Load scatters across 8- and 16-core nodes; robot
  count scales horizontally. This is where both the scheduling ceiling and
  many-robot scenes are solved.
- **Phase 3 — GPU render pod.**
  Make the render/GPU pod its own scheduling unit so only it claims the scarce
  `nvidia.com/gpu`, while Nav2 pods stay cheap CPU.

<a id="tradeoffs"></a>
## Trade-offs / open questions

- **Networking cost.** Zenoh router is one extra small pod + Service, but every
  image must carry `rmw_zenoh` and be configured to use it. Needs a rebuild.
- **State/ordering.** Nav2 pods must come up after the sim pod is serving and the
  robot is spawned; readiness/dependency handling (initContainers or
  extension-side sequencing) is a Phase 2 detail.
- **Spawn model.** Today robots spawn *into* the running sim via `gz service`.
  With Nav2 in a separate pod, "spawn robot" becomes: (a) spawn the model in the
  sim pod, then (b) create/scale that robot's Nav2 pod. The extension owns that
  two-step.
- **Deployment strategy.** For the single sim pod, prefer `Recreate` (or verify
  rolling surge fits) so a CPU bump doesn't need old+new coexisting on one node.

---

_Related: [Story 3](story3-multi-robot.md) (local Compose + Zenoh),
[Story 5 thread caps](story5-image-thread-caps.md),
[Story 4 follow-ups](story4-followups.md)._
