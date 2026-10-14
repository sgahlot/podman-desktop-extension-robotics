#!/usr/bin/env bash
set -eo pipefail

# Spawn a TurtleBot3 into a running Gazebo simulation.
# Designed to be called via: podman exec <container> /entrypoint-spawn-robot.sh <name> <x> <y> <yaw>
#
# Usage:
#   /entrypoint-spawn-robot.sh robot_1 -2.0 -0.5 0.0
#   /entrypoint-spawn-robot.sh robot_2  2.0  0.5 3.14159

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
_pai_loader="${SCRIPT_DIR}/lib/load-validate-input.sh"
[[ -f "${_pai_loader}" ]] || _pai_loader="/usr/local/lib/robotics/load-validate-input.sh"
if [[ ! -f "${_pai_loader}" ]]; then
  echo "error: load-validate-input.sh not found (tried ${SCRIPT_DIR}/lib/ and /usr/local/lib/robotics/)" >&2
  exit 1
fi
# shellcheck source=lib/load-validate-input.sh
source "${_pai_loader}"

ROBOT_NAME="${1:?Usage: $0 <robot_name> <x> <y> <yaw>}"
X_POSE="${2:?Usage: $0 <robot_name> <x> <y> <yaw>}"
Y_POSE="${3:?Usage: $0 <robot_name> <x> <y> <yaw>}"
YAW="${4:-0.0}"

pai_validate_robot_name "${ROBOT_NAME}"
pai_validate_numeric "${X_POSE}" "x"
pai_validate_numeric "${Y_POSE}" "y"
pai_validate_numeric "${YAW}" "yaw"

export HOME="${ROBOTICS_HOME:-/tmp/ros-home}"
mkdir -p "${HOME}/.ros"
export ROS_HOME="${HOME}/.ros"
export ROS_LOG_DIR="${HOME}/.ros/log"

# Overridable for stubbed unit tests (default: real image path).
# shellcheck disable=SC1090
source "${ROBOTICS_ROS_SETUP:-/opt/ros/jazzy/setup.bash}"

export TURTLEBOT3_MODEL="${TURTLEBOT3_MODEL:-waffle}"
pai_export_gz_sim_resource_path

SIM_DIR="${ROBOTICS_SIM_DIR:-/opt/ros/jazzy/share/nav2_minimal_tb3_sim}"
URDF_FILE="${SIM_DIR}/urdf/turtlebot3_waffle.urdf"
BRIDGE_CONFIG="${SIM_DIR}/configs/turtlebot3_waffle_bridge.yaml"
BRIDGE_PROBE_TOPIC="/${ROBOT_NAME}/scan"
BRIDGE_READY_TIMEOUT="${ROBOTICS_BRIDGE_READY_TIMEOUT:-8}"
if [[ ! "${BRIDGE_READY_TIMEOUT}" =~ ^[0-9]+$ ]] || [[ "${BRIDGE_READY_TIMEOUT}" -lt 1 ]] || [[ "${BRIDGE_READY_TIMEOUT}" -gt 60 ]]; then
  echo "error: ROBOTICS_BRIDGE_READY_TIMEOUT must be a whole number from 1 to 60" >&2
  exit 1
fi
if [[ ! -f "${BRIDGE_CONFIG}" ]]; then
  echo "error: Gazebo bridge config not found: ${BRIDGE_CONFIG}" >&2
  exit 1
fi

echo "[spawn] Spawning ${ROBOT_NAME} at (${X_POSE}, ${Y_POSE}, yaw=${YAW})..."

# Keep launch output so the fallback does not terminate the launch before the model
# creation request has completed. The upstream launch starts parameter_bridge before
# creating the entity; some runs leave that bridge alive but never forwarding samples.
SPAWN_LOG="${HOME}/spawn-${ROBOT_NAME}.log"
: >"${SPAWN_LOG}"
SPAWN_PID=""
BRIDGE_PID=""
RSP_PID=""
cleanup_children() {
  local pids=()
  [[ -n "${SPAWN_PID}" ]] && pids+=("${SPAWN_PID}")
  [[ -n "${BRIDGE_PID}" ]] && pids+=("${BRIDGE_PID}")
  [[ -n "${RSP_PID}" ]] && pids+=("${RSP_PID}")
  ((${#pids[@]})) || return 0
  echo "[spawn] Shutting down ${ROBOT_NAME}..."
  kill "${pids[@]}" 2>/dev/null || true
  wait "${pids[@]}" 2>/dev/null || true
}

ros2 launch nav2_minimal_tb3_sim spawn_tb3.launch.py \
  use_sim_time:=True \
  namespace:="${ROBOT_NAME}" \
  robot_name:="${ROBOT_NAME}" \
  x_pose:="${X_POSE}" \
  y_pose:="${Y_POSE}" \
  z_pose:=0.01 >>"${SPAWN_LOG}" 2>&1 &
SPAWN_PID=$!

ros2 run robot_state_publisher robot_state_publisher \
  --ros-args \
  --remap __ns:=/"${ROBOT_NAME}" \
  -r "/tf:=/${ROBOT_NAME}/tf" \
  -r "/tf_static:=/${ROBOT_NAME}/tf_static" \
  -p use_sim_time:=true \
  -p "robot_description:=$(cat "${URDF_FILE}")" &
RSP_PID=$!
trap cleanup_children EXIT
trap 'exit 130' SIGINT
trap 'exit 143' SIGTERM

echo "[spawn] Waiting for ${ROBOT_NAME} model creation..."
for ((i = 1; i <= 60; i++)); do
  if grep -q "Entity creation successful" "${SPAWN_LOG}"; then
    echo "[spawn] ${ROBOT_NAME} model created."
    break
  fi
  if ! kill -0 "${SPAWN_PID}" 2>/dev/null; then
    echo "error: spawn launch exited before creating ${ROBOT_NAME}" >&2
    cat "${SPAWN_LOG}" >&2
    exit 1
  fi
  if (( i == 60 )); then
    echo "error: timed out waiting for ${ROBOT_NAME} model creation" >&2
    cat "${SPAWN_LOG}" >&2
    exit 1
  fi
  sleep 1
done

if ROS2CLI_USE_DAEMON=0 timeout "${BRIDGE_READY_TIMEOUT}" ros2 topic echo --once "${BRIDGE_PROBE_TOPIC}" >/dev/null 2>&1; then
  echo "[spawn] Gazebo-to-ROS bridge is publishing ${BRIDGE_PROBE_TOPIC}."
else
  echo "[spawn] WARN: launch-managed bridge did not deliver ${BRIDGE_PROBE_TOPIC}; restarting it directly from ${BRIDGE_CONFIG}..."
  # Stop the silent bridge child first; then stop its ros2-launch supervisor. The Gazebo
  # model creation request has already completed, so the entity remains in the world.
  launch_bridge_pid="$(pgrep -P "${SPAWN_PID}" -f '/ros_gz_bridge/parameter_bridge' || true)"
  if [[ -n "${launch_bridge_pid}" ]]; then
    kill -TERM "${launch_bridge_pid}" 2>/dev/null || true
  fi
  kill -TERM "${SPAWN_PID}" 2>/dev/null || true
  wait "${SPAWN_PID}" 2>/dev/null || true
  SPAWN_PID=""

  BRIDGE_BIN="${ROBOTICS_BRIDGE_BIN:-$(ros2 pkg prefix ros_gz_bridge)/lib/ros_gz_bridge/parameter_bridge}"
  if [[ ! -x "${BRIDGE_BIN}" ]]; then
    echo "error: ros_gz_bridge executable not found: ${BRIDGE_BIN}" >&2
    exit 1
  fi
  "${BRIDGE_BIN}" --ros-args \
    -r "__ns:=/${ROBOT_NAME}" \
    -p "config_file:=${BRIDGE_CONFIG}" \
    -p expand_gz_topic_names:=true \
    -p use_sim_time:=true \
    >>"${HOME}/bridge-${ROBOT_NAME}.log" 2>&1 &
  BRIDGE_PID=$!

  if ! ROS2CLI_USE_DAEMON=0 timeout "${BRIDGE_READY_TIMEOUT}" ros2 topic echo --once "${BRIDGE_PROBE_TOPIC}" >/dev/null 2>&1; then
    echo "error: standalone ros_gz_bridge did not deliver ${BRIDGE_PROBE_TOPIC} within ${BRIDGE_READY_TIMEOUT}s" >&2
    cat "${HOME}/bridge-${ROBOT_NAME}.log" >&2
    exit 1
  fi
  echo "[spawn] Standalone ros_gz_bridge is publishing ${BRIDGE_PROBE_TOPIC}."
fi

echo "[spawn] ${ROBOT_NAME} spawn initiated. Waiting for processes..."

if [[ -n "${BRIDGE_PID}" ]]; then
  wait "${BRIDGE_PID}" "${RSP_PID}"
else
  wait "${SPAWN_PID}" "${RSP_PID}"
fi
