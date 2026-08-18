# Item 5 (remaining) — Cap sim thread pools to the CPU quota

**Status:** ✅ **implemented in `entrypoint-gazebo.sh`** (derive-from-cgroup form
below) — **needs an image rebuild + push by the user**, then live-validate.
Complementary to the configurable CPU count (`manifests.ts` + `config.cpu`,
default 8); see `story4-followups.md` item 5 and
`story7-multipod-openshift-architecture.md` for the multi-pod direction.

The shipped block caps `OMP_/OPENBLAS_/LP_/MESA_/GALLIUM_NUM_THREADS` to the
cgroup quota (v2 `cpu.max`, v1 `cfs_quota_us/cfs_period_us` fallback), and **only
when a quota exists** so the unlimited local path is untouched. Override/force
with `PHYSICAL_AI_CPU_CAP`. The reference design below is retained for context.

## Why

The pod is Guaranteed-QoS capped at N CPUs (currently 8 for software rendering),
but the container still sees the **node's** `nproc` (e.g. 16). Gazebo, Ogre
(llvmpipe), and OpenMP-based libs size their thread pools to `nproc`, not the
cgroup quota. During bursts those pools demand more than the quota, so CFS
throttles most 100 ms periods → micro-stutter even when average RTF ≈ 1.0.
Widening the quota (the 8-CPU bump) reduces this; **capping the pools to the
quota removes the oversubscription at any core count** — the proper fix.

## Where

Set the caps in the sim image so every downstream process inherits them. Add
them near the top of the Gazebo entrypoint (after `source .../setup.bash`,
before Xvfb/Gazebo start), or as `ENV` in the Containerfile:

- Entrypoint: `physical-ai/packages/backend/assets/ros2-jazzy-sim/entrypoint-gazebo.sh`
  (around lines 42–53, where `HOME`/`GZ_SIM_RESOURCE_PATH` are exported)
- Containerfile: `physical-ai/packages/backend/assets/ros2-jazzy-sim/Containerfile`

Set the cap from the deployed CPU quota so it tracks `manifests.ts`. Simplest is
a fixed value matching the request (8); better is to derive it from the cgroup
quota at runtime.

```bash
# Cap thread pools to the CPU quota so they stop oversubscribing (item 5).
# Derive the quota from the cgroup (v2), fall back to a sensible default.
_pai_quota() {
  local q p
  if [[ -r /sys/fs/cgroup/cpu.max ]]; then
    read -r q p < /sys/fs/cgroup/cpu.max
    [[ "${q}" != "max" && -n "${p}" && "${p}" -gt 0 ]] && echo $(( (q + p - 1) / p )) && return
  fi
  echo "${PHYSICAL_AI_CPU_CAP:-8}"
}
PAI_CPUS="$(_pai_quota)"

export OMP_NUM_THREADS="${OMP_NUM_THREADS:-${PAI_CPUS}}"   # OpenMP (collision/physics libs)
export LP_NUM_THREADS="${LP_NUM_THREADS:-${PAI_CPUS}}"     # llvmpipe/Mesa software rasterizer (the GUI's ~2.3-core hog)
export MESA_NUM_THREADS="${MESA_NUM_THREADS:-${PAI_CPUS}}" # some Mesa builds read this instead
export GALLIUM_NUM_THREADS="${GALLIUM_NUM_THREADS:-${PAI_CPUS}}"
```

## Notes / caveats

- **Highest-value knob is `LP_NUM_THREADS`** — llvmpipe is the biggest CPU
  consumer (~2.3 cores for the GUI). Capping it alone should remove most stutter.
- **Not everything is env-cappable.** Ogre2's render worker count and DART
  physics *island* threads aren't simple env vars — island threading is a world
  `<physics>` SDF setting (`tb3_sandbox.sdf.xacro`), not an env. If stutter
  persists after the env caps, revisit the world file.
- **Don't cap below what one robot needs.** Under software render the physics/
  sensor step is CPU-bound; too low a cap trades stutter for a lower RTF. Set the
  cap == quota (not below), then measure RTF before/after.
- **Local (podman) path:** these are baked into the image, so the local sim gets
  them too. Only the *derive-from-cgroup* line depends on a quota existing; the
  `PHYSICAL_AI_CPU_CAP` fallback covers the unlimited local case (set it if you
  want the local sim capped as well).

## Verify (after rebuild + redeploy)

1. In the pod: `nproc` still shows the node count, but
   `echo $LP_NUM_THREADS $OMP_NUM_THREADS` shows the cap (== quota).
2. During active nav, throttling drops sharply:
   `cat /sys/fs/cgroup/cpu.stat` → `nr_throttled` grows far slower than before
   (was ~98% of periods).
3. RTF stays ≈ 1.0 (didn't regress) and motion is visibly smoother in noVNC.
