#!/usr/bin/env bash
set -eo pipefail

# Launch the configured Nav2 navigation stack for a spawned robot.
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
[[ -f "${_pai_loader}" ]] || _pai_loader="/usr/local/lib/robotics/load-validate-input.sh"
if [[ ! -f "${_pai_loader}" ]]; then
  echo "error: load-validate-input.sh not found (tried ${SCRIPT_DIR}/lib/ and /usr/local/lib/robotics/)" >&2
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
source "${ROBOTICS_ROS_SETUP:-/opt/ros/humble/setup.bash}"
pai_load_robot_definition

PATCH_SCRIPT="${SCRIPT_DIR}/lib/patch-nav2-params.py"
[[ -f "${PATCH_SCRIPT}" ]] || PATCH_SCRIPT="/usr/local/lib/robotics/patch-nav2-params.py"
if [[ ! -f "${PATCH_SCRIPT}" ]]; then
  echo "error: patch-nav2-params.py not found (tried ${SCRIPT_DIR}/lib/ and /usr/local/lib/robotics/)" >&2
  exit 1
fi

PARAMS_FILE="${HOME}/nav2-${ROBOT_NAME}-params.yaml"
MAP_FILE="${ROBOTICS_NAV2_MAP}"
NAV2_PARAMS_SOURCE="${PHYSICAL_AI_NAV2_PARAMS}"

python3 "${PATCH_SCRIPT}" --source "${NAV2_PARAMS_SOURCE}" --output "${PARAMS_FILE}"

echo "[nav2] Starting Nav2 bringup for ${ROBOT_NAME} (map: ${MAP_FILE})..."

# navigation_launch.py alone applies RewrittenYaml root_key without PushROSNamespace,
# which leaves params under ${ROBOT_NAME} while nodes stay at /. bringup_launch.py
# applies both, which matches namespaced robot topics (/robot_1/scan, /robot_1/tf, ...).
ros2 launch "${PHYSICAL_AI_NAV2_PACKAGE}" "${PHYSICAL_AI_NAV2_LAUNCH}" \
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
SPAWN_X="${ROBOTICS_SPAWN_X:--2.0}"
SPAWN_Y="${ROBOTICS_SPAWN_Y:--0.5}"
# Bound the entire initialization, including AMCL readiness and acknowledgement.
AMCL_READY_ATTEMPTS="${ROBOTICS_AMCL_READY_ATTEMPTS:-60}"
POSE_SEED_SCRIPT="${SCRIPT_DIR}/lib/seed-initial-pose.py"
[[ -f "${POSE_SEED_SCRIPT}" ]] || POSE_SEED_SCRIPT="/usr/local/lib/robotics/seed-initial-pose.py"
python3 "${POSE_SEED_SCRIPT}" "${ROBOT_NAME}" "${SPAWN_X}" "${SPAWN_Y}" "${AMCL_READY_ATTEMPTS}" &
INITIAL_POSE_PID=$!

echo "[nav2] Nav2 launched for ${ROBOT_NAME} (PID ${NAV2_PID}). Waiting..."

term_handler() {
  echo "[nav2] Shutting down Nav2 for ${ROBOT_NAME}..."
  kill "${INITIAL_POSE_PID}" "${NAV2_PID}" 2>/dev/null || true
  wait "${INITIAL_POSE_PID}" "${NAV2_PID}" 2>/dev/null || true
}

trap term_handler SIGTERM SIGINT

# A failed initializer must not leave an orphan bringup that future warm-up
# attempts mistake for a progressing startup. Readiness still requires TF and
# active bt_navigator in the backend; AMCL acknowledgement alone is not warm.
if wait "${INITIAL_POSE_PID}"; then
  wait "${NAV2_PID}"
else
  echo "[nav2] Initial-pose initialization failed for ${ROBOT_NAME}; stopping bringup" >&2
  kill "${NAV2_PID}" 2>/dev/null || true
  wait "${NAV2_PID}" 2>/dev/null || true
  exit 1
fi
