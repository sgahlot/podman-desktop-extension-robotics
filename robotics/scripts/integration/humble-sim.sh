#!/usr/bin/env bash
# Explicit native-container smoke test; no registry push or extension loading.
# Usage: bash scripts/integration/humble-sim.sh <image> [arm64|amd64]
# Optional: HUMBLE_SMOKE_UID=10001:0 to exercise an arbitrary non-root UID.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
IMAGE="${1:?Usage: $0 <image> [arm64|amd64]}"
ARCH="${2:-arm64}"
[[ "${ARCH}" == arm64 || "${ARCH}" == amd64 ]] || { echo 'invalid architecture' >&2; exit 1; }
[[ "$(podman image inspect "${IMAGE}" --format '{{.Architecture}}')" == "${ARCH}" ]] || {
  echo "image architecture does not match ${ARCH}" >&2; exit 1;
}
CONTAINER=""
cleanup() {
  if [[ -n "${CONTAINER}" ]]; then
    if [[ "$1" != 0 ]]; then
      local log_dir="${HUMBLE_SMOKE_LOG_DIR:-}"
      [[ -n "${log_dir}" ]] || log_dir="$(mktemp -d "${TMPDIR:-/tmp}/humble-sim-failure.XXXXXX")"
      mkdir -p "${log_dir}"
      podman logs "${CONTAINER}" > "${log_dir}/gazebo.log" 2>&1 || true
      # cp also works after a server abort has stopped the container.
      podman cp "${CONTAINER}:/tmp/ros-home/spawn-robot_test.log" "${log_dir}/spawn.log" >/dev/null 2>&1 || true
      podman cp "${CONTAINER}:/tmp/ros-home/nav2-smoke.log" "${log_dir}/nav2.log" >/dev/null 2>&1 || true
      podman cp "${CONTAINER}:/tmp/ros-home/nav2-peer.log" "${log_dir}/nav2-peer.log" >/dev/null 2>&1 || true
      echo "Runtime failure evidence: ${log_dir}" >&2
      tail -n 35 "${log_dir}/gazebo.log" >&2
    fi
    podman rm -f "${CONTAINER}" >/dev/null
  fi
}
trap 'status=$?; trap - EXIT; cleanup "$status"; exit "$status"' EXIT
USER_ARGS=()
[[ -z "${HUMBLE_SMOKE_UID:-}" ]] || USER_ARGS=(--user "${HUMBLE_SMOKE_UID}")
CONTAINER="$(podman run -d --platform "linux/${ARCH}" "${USER_ARGS[@]+"${USER_ARGS[@]}"}" \
  --shm-size 512m -e ROBOTICS_USE_GPU=0 -e ROBOTICS_CPU_CAP=4 \
  -e ROS_DOMAIN_ID=171 -e ROS_LOCALHOST_ONLY=1 -e "GZ_PARTITION=appeng-6071-smoke-$$" \
  "${IMAGE}" /entrypoint-gazebo.sh)"
podman exec "${CONTAINER}" sha256sum -c /opt/physical-ai/sources/ogre-next/installed-library.sha256 >/dev/null
echo 'PASS: committed OGRE library matches recorded patched build'
podman cp "${ROOT}/packages/backend/assets/ros2-humble-turtlebot3/test/runtime-smoke.py" "${CONTAINER}:/tmp/runtime-smoke.py"
podman exec "${CONTAINER}" timeout 150 bash -c '
  set -eo pipefail
  source "$ROBOTICS_ROS_SETUP"
  for ((i=0; i<120; i++)); do
    if gz service -l | grep -q /world/tb3_sandbox/create; then exit 0; fi
    sleep 1
  done
  exit 1'
podman exec "${CONTAINER}" python3 -c '
import urllib.request
for port in (6080, 8080):
    assert urllib.request.urlopen(f"http://localhost:{port}", timeout=10).status == 200
print("PASS: noVNC and landing HTTP endpoints")'
probe() {
  podman exec "${CONTAINER}" timeout 420 bash -c \
    'set -e; export HOME=/tmp/ros-home; source "$ROBOTICS_ROS_SETUP"; python3 /tmp/runtime-smoke.py "$@"' _ "$@"
}
check_localization_ack() {
  podman exec "${CONTAINER}" grep -Fq '[pose-seed] AMCL localization acknowledged for robot_test' /tmp/ros-home/nav2-smoke.log
  echo 'PASS: automatic AMCL initialization acknowledged without manual seeding'
}
probe clock
podman exec -d "${CONTAINER}" /entrypoint-spawn-robot.sh robot_test -2.0 -0.5 0.0 >/dev/null
probe sensors
podman exec -d "${CONTAINER}" bash -c '/entrypoint-nav2.sh robot_test > /tmp/ros-home/nav2-smoke.log 2>&1' >/dev/null
probe navigation
check_localization_ack
# Keep a second robot alive while exercising both navigation stacks. The two
# routes stay on opposite sides of the map to avoid a deliberate collision test.
podman exec -d "${CONTAINER}" /entrypoint-spawn-robot.sh robot_peer 2.0 0.5 3.14159 >/dev/null
probe sensors robot_peer
podman exec -d "${CONTAINER}" bash -c '/entrypoint-nav2.sh robot_peer > /tmp/ros-home/nav2-peer.log 2>&1' >/dev/null
probe clock
probe navigation robot_peer 1.0 0.5
podman exec "${CONTAINER}" grep -Fq '[pose-seed] AMCL localization acknowledged for robot_peer' /tmp/ros-home/nav2-peer.log
probe navigation robot_test -2.0 -0.5
# Stop this robot's launch trees before removing it, matching backend teardown.
podman exec "${CONTAINER}" bash -c \
  'pkill -TERM -f "$1" || true; sleep 2; pkill -KILL -f "$1" || true' _ \
  '(namespace:=|robot_name:=|__ns:=/|entrypoint-(spawn-robot|nav2)\.sh )robot_test([ /:]|$)'
podman exec "${CONTAINER}" timeout 30 bash -c '
  set -eo pipefail
  source "$ROBOTICS_ROS_SETUP"
  gz service -s /world/tb3_sandbox/remove --reqtype gz.msgs.Entity --reptype gz.msgs.Boolean \
    --timeout 5000 --req "name: \"robot_test\", type: MODEL" | grep -q "data: true"
  for ((i=0; i<20; i++)); do
    models=$(gz model --list)
    if ! grep -q robot_test <<< "$models"; then exit 0; fi
    sleep 1
  done
  exit 1'
# The remaining robot and world clock must survive removal of the first robot.
probe clock
probe sensors robot_peer
podman exec -d "${CONTAINER}" /entrypoint-spawn-robot.sh robot_test -2.0 -0.5 0.0 >/dev/null
probe sensors
podman exec -d "${CONTAINER}" bash -c '/entrypoint-nav2.sh robot_test > /tmp/ros-home/nav2-smoke.log 2>&1' >/dev/null
probe navigation
check_localization_ack
probe clock
echo "PASS: Humble ${ARCH} two-robot clocks/sensors/Nav2 and remove/re-spawn (not OpenShift/manual acceptance)"
