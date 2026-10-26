#!/usr/bin/env bash
set -euo pipefail

# Spawn a profile SDF into the already-running Gazebo world. The profile path,
# identity, and pose arrive as argv; no user value is evaluated by a shell.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
_pai_loader="${SCRIPT_DIR}/lib/load-validate-input.sh"
[[ -f "${_pai_loader}" ]] || _pai_loader="/usr/local/lib/robotics/load-validate-input.sh"
source "${_pai_loader}"

if [[ $# -ne 7 ]]; then
  echo "error: usage: $0 <robot-name> <world> <absolute-sdf-path> <x> <y> <z> <yaw>" >&2
  exit 2
fi

ROBOT_NAME="$1"
WORLD="$2"
MODEL_FILE="$3"
X="$4"
Y="$5"
Z="$6"
YAW="$7"

pai_validate_robot_name "${ROBOT_NAME}"
pai_validate_identifier "${WORLD}" "world"
if [[ ! "${MODEL_FILE}" =~ ^/opt/physical-ai/robots/[a-z][a-z0-9_-]{0,63}/([a-zA-Z0-9_.-]+/)*[a-zA-Z0-9_.-]+\.sdf$ || "${MODEL_FILE}" == *..* ]]; then
  echo "error: invalid embedded SDF path '${MODEL_FILE}'" >&2
  exit 1
fi
pai_validate_numeric "${X}" "x"
pai_validate_numeric "${Y}" "y"
pai_validate_numeric "${Z}" "z"
pai_validate_numeric "${YAW}" "yaw"
if [[ ! -r "${MODEL_FILE}" ]]; then
  echo "error: embedded SDF '${MODEL_FILE}' is not readable in this image; build and use the derived robot image" >&2
  exit 1
fi

export HOME="${ROBOTICS_HOME:-/tmp/ros-home}"
export ROS_HOME="${HOME}/.ros"
export ROS_LOG_DIR="${HOME}/.ros/log"
mkdir -p "${ROS_LOG_DIR}"
PROFILE_ID="${MODEL_FILE#/opt/physical-ai/robots/}"
PROFILE_ID="${PROFILE_ID%%/*}"
PROFILE_ROOT="/opt/physical-ai/robots/${PROFILE_ID}"
export GZ_SIM_RESOURCE_PATH="${PROFILE_ROOT}:${PROFILE_ROOT}/robots:$(dirname "${MODEL_FILE}"):${GZ_SIM_RESOURCE_PATH:-}"
pai_source_ros_setup

exec ros2 run ros_gz_sim create \
  -world "${WORLD}" \
  -file "${MODEL_FILE}" \
  -name "${ROBOT_NAME}" \
  -x "${X}" -y "${Y}" -z "${Z}" \
  -R 0 -P 0 -Y "${YAW}"
