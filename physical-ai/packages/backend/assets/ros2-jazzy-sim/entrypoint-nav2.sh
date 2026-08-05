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

echo "[nav2] Starting Nav2 navigation stack for ${ROBOT_NAME}..."

ros2 launch nav2_bringup navigation_launch.py \
  namespace:="${ROBOT_NAME}" \
  use_sim_time:=True \
  autostart:=True &
NAV2_PID=$!

echo "[nav2] Nav2 launched for ${ROBOT_NAME} (PID ${NAV2_PID}). Waiting..."

term_handler() {
  echo "[nav2] Shutting down Nav2 for ${ROBOT_NAME}..."
  kill "${NAV2_PID}" 2>/dev/null || true
  wait "${NAV2_PID}" 2>/dev/null || true
}

trap term_handler SIGTERM SIGINT

wait "${NAV2_PID}"
