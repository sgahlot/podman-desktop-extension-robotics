#!/usr/bin/env bash
set -eo pipefail

# Launch the Nav2 navigation stack for a spawned TurtleBot3 robot.
# Designed to be called via: podman exec -d <container> /entrypoint-nav2.sh <robot_name>
#
# The robot must already be spawned (entrypoint-spawn-robot.sh) before running this.
# Nav2 needs a few seconds after launch to complete lifecycle transitions before
# it can accept navigation goals.
#
# Usage:
#   /entrypoint-nav2.sh robot_1

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
_pai_loader="${SCRIPT_DIR}/lib/load-validate-input.sh"
[[ -f "${_pai_loader}" ]] || _pai_loader="/usr/local/lib/physical-ai/load-validate-input.sh"
if [[ ! -f "${_pai_loader}" ]]; then
  echo "error: load-validate-input.sh not found (tried ${SCRIPT_DIR}/lib/ and /usr/local/lib/physical-ai/)" >&2
  exit 1
fi
# shellcheck source=lib/load-validate-input.sh
source "${_pai_loader}"

ROBOT_NAME="${1:?Usage: $0 <robot_name>}"
pai_validate_robot_name "${ROBOT_NAME}"

export HOME="/tmp/ros-home"
mkdir -p "${HOME}/.ros"
export ROS_HOME="${HOME}/.ros"
export ROS_LOG_DIR="${HOME}/.ros/log"

# shellcheck disable=SC1090
source "${PHYSICAL_AI_ROS_SETUP:-/opt/ros/jazzy/setup.bash}"

PATCH_SCRIPT="${SCRIPT_DIR}/lib/patch-nav2-params.py"
[[ -f "${PATCH_SCRIPT}" ]] || PATCH_SCRIPT="/usr/local/lib/physical-ai/patch-nav2-params.py"
if [[ ! -f "${PATCH_SCRIPT}" ]]; then
  echo "error: patch-nav2-params.py not found (tried ${SCRIPT_DIR}/lib/ and /usr/local/lib/physical-ai/)" >&2
  exit 1
fi

PARAMS_FILE="${HOME}/nav2-${ROBOT_NAME}-params.yaml"
MAP_FILE="${PHYSICAL_AI_NAV2_MAP:-/opt/ros/jazzy/share/nav2_bringup/maps/tb3_sandbox.yaml}"

python3 "${PATCH_SCRIPT}" --output "${PARAMS_FILE}"

echo "[nav2] Starting Nav2 bringup for ${ROBOT_NAME} (map: ${MAP_FILE})..."

# navigation_launch.py alone applies RewrittenYaml root_key without PushROSNamespace,
# which leaves params under ${ROBOT_NAME} while nodes stay at /. bringup_launch.py
# applies both, which matches namespaced robot topics (/robot_1/scan, /robot_1/tf, ...).
ros2 launch nav2_bringup bringup_launch.py \
  namespace:="${ROBOT_NAME}" \
  use_namespace:=True \
  use_composition:=False \
  use_sim_time:=True \
  autostart:=True \
  slam:=False \
  use_localization:=True \
  map:="${MAP_FILE}" \
  params_file:="${PARAMS_FILE}" &
NAV2_PID=$!

# AMCL needs an initial pose before it publishes map->odom. Defaults match spawn entrypoint.
SPAWN_X="${PHYSICAL_AI_SPAWN_X:--2.0}"
SPAWN_Y="${PHYSICAL_AI_SPAWN_Y:--0.5}"
# Max seconds to wait for AMCL to come up before seeding the pose anyway.
AMCL_READY_ATTEMPTS="${PHYSICAL_AI_AMCL_READY_ATTEMPTS:-60}"
(
  # Seed the initial pose as soon as AMCL is subscribed to /initialpose, instead of a
  # blind `sleep 12` — this starts localization/convergence several seconds sooner and
  # cuts the first-navigate delay. AMCL creates the /initialpose subscription during
  # activation, so a non-zero subscription count means the one-shot publish will land.
  # Fall back to publishing anyway if it never appears, so behaviour never regresses.
  POSE_TOPIC="/${ROBOT_NAME}/initialpose"
  amcl_ready=""
  for ((i = 1; i <= AMCL_READY_ATTEMPTS; i++)); do
    if ros2 topic info "${POSE_TOPIC}" 2>/dev/null | grep -qE "Subscription count: [1-9]"; then
      amcl_ready="yes"
      echo "[nav2] AMCL subscribed to ${POSE_TOPIC} after ~${i}s; seeding initial pose"
      break
    fi
    sleep 1
  done
  [[ -n "${amcl_ready}" ]] || echo "[nav2] AMCL not detected after ${AMCL_READY_ATTEMPTS}s; seeding initial pose anyway"
  # Brief settle so AMCL finishes activation before the one-shot publish.
  sleep 1
  ros2 topic pub --once "${POSE_TOPIC}" geometry_msgs/msg/PoseWithCovarianceStamped \
    "{header: {frame_id: map}, pose: {pose: {position: {x: ${SPAWN_X}, y: ${SPAWN_Y}, z: 0.0}, orientation: {w: 1.0}}, covariance: [0.25, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.25, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.06853891909122467]}}" \
    --use-sim-time
) &
INITIAL_POSE_PID=$!

echo "[nav2] Nav2 launched for ${ROBOT_NAME} (PID ${NAV2_PID}). Waiting..."

term_handler() {
  echo "[nav2] Shutting down Nav2 for ${ROBOT_NAME}..."
  kill "${INITIAL_POSE_PID}" "${NAV2_PID}" 2>/dev/null || true
  wait "${INITIAL_POSE_PID}" "${NAV2_PID}" 2>/dev/null || true
}

trap term_handler SIGTERM SIGINT

wait "${NAV2_PID}"
