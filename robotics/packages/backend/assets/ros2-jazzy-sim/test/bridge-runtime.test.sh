#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SPAWN="${ROOT}/entrypoint-spawn-robot.sh"
TMP="$(mktemp -d)"
TARGET_PID=""

cleanup() {
  if [[ -n "${TARGET_PID}" ]]; then
    kill -TERM "${TARGET_PID}" 2>/dev/null || true
    wait "${TARGET_PID}" 2>/dev/null || true
  fi
  rm -rf "${TMP}"
}
trap cleanup EXIT

setup_case() {
  local case_dir="$1"
  mkdir -p "${case_dir}/bin" "${case_dir}/sim/urdf" "${case_dir}/sim/configs" "${case_dir}/ros/lib/ros_gz_bridge"
  : > "${case_dir}/setup.bash"
  : > "${case_dir}/sim/urdf/turtlebot3_waffle.urdf"
  : > "${case_dir}/sim/configs/turtlebot3_waffle_bridge.yaml"
  cat > "${case_dir}/bin/ros2" <<'STUB'
#!/usr/bin/env bash
set -euo pipefail
case "${1:-}" in
  launch)
    echo '[INFO] Entity creation successful.'
    "${FAKE_DIRECT_BRIDGE_BIN}" --launch-managed &
    child=$!
    stop() { [[ -n "${child}" ]] && kill "${child}" 2>/dev/null || true; [[ -n "${child}" ]] && wait "${child}" 2>/dev/null || true; exit 0; }
    trap stop TERM INT
    while true; do sleep 1 & child=$!; wait "${child}" || true; child=""; done
    ;;
  run)
    child=""
    stop() { [[ -n "${child}" ]] && kill "${child}" 2>/dev/null || true; [[ -n "${child}" ]] && wait "${child}" 2>/dev/null || true; exit 0; }
    trap stop TERM INT
    while true; do sleep 1 & child=$!; wait "${child}" || true; child=""; done
    ;;
  pkg)
    printf '%s\n' "${FAKE_ROS_PREFIX}"
    ;;
  topic)
    for _ in {1..30}; do
      [[ -f "${FAKE_LAUNCH_BRIDGE_READY:-/nonexistent}" || -f "${FAKE_DIRECT_BRIDGE_READY:-/nonexistent}" ]] && exit 0
      [[ "${FAKE_TOPIC_EARLY_EXIT:-0}" == "1" ]] && exit 1
      sleep 0.1
    done
    exit 1
    ;;
  *) exit 2 ;;
esac
STUB
  chmod +x "${case_dir}/bin/ros2"
cat > "${case_dir}/ros/lib/ros_gz_bridge/parameter_bridge" <<'STUB'
#!/usr/bin/env bash
set -euo pipefail
if [[ "${1:-}" == "--launch-managed" ]]; then
  child=""
  stop_launch() { [[ -n "${child}" ]] && kill "${child}" 2>/dev/null || true; [[ -n "${child}" ]] && wait "${child}" 2>/dev/null || true; rm -f "${FAKE_LAUNCH_BRIDGE_READY}"; exit 0; }
  if [[ "${FAKE_LAUNCH_BRIDGE_READY}" != "/nonexistent" ]]; then
    sleep "${FAKE_LAUNCH_BRIDGE_DELAY:-0}"
    touch "${FAKE_LAUNCH_BRIDGE_READY}"
  fi
  trap stop_launch TERM INT
  while true; do sleep 1 & child=$!; wait "${child}" || true; child=""; done
fi
printf '%s\n' "$*" > "${FAKE_DIRECT_BRIDGE_ARGS}"
[[ "${FAKE_DIRECT_BRIDGE_SILENT:-0}" == "1" ]] || touch "${FAKE_DIRECT_BRIDGE_READY}"
child=""
stop() { [[ -n "${child}" ]] && kill "${child}" 2>/dev/null || true; [[ -n "${child}" ]] && wait "${child}" 2>/dev/null || true; rm -f "${FAKE_DIRECT_BRIDGE_READY}"; exit 0; }
trap stop TERM INT
while true; do sleep 1 & child=$!; wait "${child}" || true; child=""; done
STUB
  chmod +x "${case_dir}/ros/lib/ros_gz_bridge/parameter_bridge"
}

start_spawn() {
  local case_dir="$1"
  env \
    PATH="${case_dir}/bin:${PATH}" \
    ROBOTICS_ROS_SETUP="${case_dir}/setup.bash" \
    ROBOTICS_SIM_DIR="${case_dir}/sim" \
    ROBOTICS_BRIDGE_BIN="${case_dir}/ros/lib/ros_gz_bridge/parameter_bridge" \
    FAKE_ROS_PREFIX="${case_dir}/ros" \
    FAKE_DIRECT_BRIDGE_BIN="${case_dir}/ros/lib/ros_gz_bridge/parameter_bridge" \
    FAKE_DIRECT_BRIDGE_READY="${case_dir}/direct-ready" \
    FAKE_DIRECT_BRIDGE_ARGS="${case_dir}/direct-args" \
    FAKE_DIRECT_BRIDGE_SILENT="${FAKE_DIRECT_BRIDGE_SILENT:-0}" \
    FAKE_LAUNCH_BRIDGE_DELAY="${FAKE_LAUNCH_BRIDGE_DELAY:-0}" \
    FAKE_TOPIC_EARLY_EXIT="${FAKE_TOPIC_EARLY_EXIT:-0}" \
    FAKE_LAUNCH_BRIDGE_READY="${FAKE_LAUNCH_BRIDGE_READY:-/nonexistent}" \
    ROBOTICS_BRIDGE_READY_TIMEOUT="${TEST_BRIDGE_READY_TIMEOUT:-4}" \
    ROBOTICS_HOME="${case_dir}/home" \
    bash "${SPAWN}" robot_test 0 0 0 > "${case_dir}/spawn.log" 2>&1 &
  TARGET_PID=$!
}

wait_for_text() {
  local file="$1" text="$2"
  for _ in {1..200}; do
    [[ -f "${file}" ]] && grep -Fq "${text}" "${file}" && return 0
    sleep 0.1
  done
  return 1
}

echo "=== launch-managed bridge fallback ==="
FALLBACK="${TMP}/fallback"
setup_case "${FALLBACK}"
FAKE_LAUNCH_BRIDGE_READY="/nonexistent"
start_spawn "${FALLBACK}"
if ! wait_for_text "${FALLBACK}/spawn.log" "Direct ros_gz_bridge is publishing /robot_test/scan; retaining launch-managed bridge."; then
  echo "FAIL: silent launch bridge was not replaced by standalone bridge"
  cat "${FALLBACK}/spawn.log"
  exit 1
fi
if ! grep -Fq "config_file:=${FALLBACK}/sim/configs/turtlebot3_waffle_bridge.yaml" "${FALLBACK}/direct-args" ||
   ! grep -Fq "__ns:=/robot_test" "${FALLBACK}/direct-args"; then
  echo "FAIL: fallback bridge did not receive namespace and installed bridge config"
  exit 1
fi
kill -TERM "${TARGET_PID}" 2>/dev/null || true
wait "${TARGET_PID}" 2>/dev/null || true
TARGET_PID=""
[[ ! -e "${FALLBACK}/direct-ready" ]] || { echo "FAIL: fallback bridge was not cleaned up"; exit 1; }
echo "PASS: silent launch bridge is replaced, configured, and cleaned up"

echo
echo "=== healthy launch-managed bridge ==="
HEALTHY="${TMP}/healthy"
setup_case "${HEALTHY}"
FAKE_LAUNCH_BRIDGE_READY="${HEALTHY}/launch-ready"
touch "${HEALTHY}/launch-ready"
start_spawn "${HEALTHY}"
if ! wait_for_text "${HEALTHY}/spawn.log" "Gazebo-to-ROS bridge is publishing /robot_test/scan."; then
  echo "FAIL: healthy launch bridge was not accepted"
  cat "${HEALTHY}/spawn.log"
  exit 1
fi
if [[ -e "${HEALTHY}/direct-args" ]]; then
  echo "FAIL: healthy launch bridge unnecessarily started fallback bridge"
  exit 1
fi
kill -TERM "${TARGET_PID}" 2>/dev/null || true
wait "${TARGET_PID}" 2>/dev/null || true
TARGET_PID=""
echo "PASS: healthy launch bridge is retained"

echo
echo "=== delayed launch-managed bridge ==="
DELAYED="${TMP}/delayed"
setup_case "${DELAYED}"
FAKE_LAUNCH_BRIDGE_READY="${DELAYED}/launch-ready"
FAKE_LAUNCH_BRIDGE_DELAY=2
FAKE_TOPIC_EARLY_EXIT=1
TEST_BRIDGE_READY_TIMEOUT=6
start_spawn "${DELAYED}"
if ! wait_for_text "${DELAYED}/spawn.log" "Gazebo-to-ROS bridge is publishing /robot_test/scan."; then
  echo "FAIL: delayed launch bridge was not accepted"
  cat "${DELAYED}/spawn.log"
  exit 1
fi
if [[ -e "${DELAYED}/direct-args" ]]; then
  echo "FAIL: delayed launch bridge unnecessarily started fallback bridge"
  exit 1
fi
kill -TERM "${TARGET_PID}" 2>/dev/null || true
wait "${TARGET_PID}" 2>/dev/null || true
TARGET_PID=""
unset FAKE_LAUNCH_BRIDGE_DELAY FAKE_TOPIC_EARLY_EXIT TEST_BRIDGE_READY_TIMEOUT
echo "PASS: delayed launch bridge is retained"

echo
echo "=== failed direct bridge retains launch bridge ==="
RETAIN="${TMP}/retain"
setup_case "${RETAIN}"
FAKE_LAUNCH_BRIDGE_READY="/nonexistent"
FAKE_DIRECT_BRIDGE_SILENT=1
TEST_BRIDGE_READY_TIMEOUT=6
start_spawn "${RETAIN}"
if ! wait_for_text "${RETAIN}/spawn.log" "retaining launch-managed bridge"; then
  echo "FAIL: failed direct bridge did not retain launch-managed bridge"
  cat "${RETAIN}/spawn.log"
  exit 1
fi
if ! kill -0 "${TARGET_PID}" 2>/dev/null; then
  echo "FAIL: failed direct bridge stopped the launch-managed bridge"
  exit 1
fi
kill -TERM "${TARGET_PID}" 2>/dev/null || true
wait "${TARGET_PID}" 2>/dev/null || true
TARGET_PID=""
unset FAKE_DIRECT_BRIDGE_SILENT TEST_BRIDGE_READY_TIMEOUT
echo "PASS: failed direct bridge retains launch bridge"

echo
echo "Results: 4 passed, 0 failed"
