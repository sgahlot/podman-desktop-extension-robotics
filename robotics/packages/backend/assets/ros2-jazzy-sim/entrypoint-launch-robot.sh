#!/usr/bin/env bash
set -eo pipefail

# Launch a robot configuration already installed in this simulation image.
# The package, launch file, and `name:=value` arguments arrive as argv, never
# as shell input. `--validate` is a short synchronous preflight used by the UI.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
_pai_loader="${SCRIPT_DIR}/lib/load-validate-input.sh"
[[ -f "${_pai_loader}" ]] || _pai_loader="/usr/local/lib/robotics/load-validate-input.sh"
source "${_pai_loader}"

PACKAGE="${1:?Usage: $0 <package> <launch-file> [name:=value ...]}"
LAUNCH_FILE="${2:?Usage: $0 <package> <launch-file> [name:=value ...]}"
shift 2

pai_validate_package_name "${PACKAGE}"
if [[ ! "${LAUNCH_FILE}" =~ ^([a-zA-Z0-9_-]+/)*[a-zA-Z0-9_-]+\.launch\.(py|xml|yaml)$ || "${LAUNCH_FILE}" == *..* ]]; then
  echo "error: invalid launch file '${LAUNCH_FILE}'" >&2
  exit 1
fi

VALIDATE_ONLY=false
if [[ "${1:-}" == "--validate" ]]; then
  VALIDATE_ONLY=true
  shift
fi
for argument in "$@"; do
  if [[ ! "${argument}" =~ ^[a-zA-Z][a-zA-Z0-9_]{0,63}:= ]]; then
    echo "error: invalid launch argument '${argument}' (expected name:=value)" >&2
    exit 1
  fi
  if [[ "${argument}" == file:=/opt/physical-ai/robots/* ]]; then
    MODEL_FILE="${argument#file:=}"
    if [[ ! "${MODEL_FILE}" =~ ^/opt/physical-ai/robots/[a-z][a-z0-9_-]{0,63}/([a-zA-Z0-9_.-]+/)*[a-zA-Z0-9_.-]+\.sdf$ || "${MODEL_FILE}" == *..* ]]; then
      echo "error: invalid embedded SDF path '${MODEL_FILE}'" >&2
      exit 1
    fi
    if [[ ! -r "${MODEL_FILE}" ]]; then
      echo "error: embedded SDF '${MODEL_FILE}' is not readable in this image" >&2
      exit 1
    fi
    PROFILE_ID="${MODEL_FILE#/opt/physical-ai/robots/}"
    PROFILE_ID="${PROFILE_ID%%/*}"
    PROFILE_ROOT="/opt/physical-ai/robots/${PROFILE_ID}"
    export GZ_SIM_RESOURCE_PATH="${PROFILE_ROOT}:${PROFILE_ROOT}/robots:$(dirname "${MODEL_FILE}"):${GZ_SIM_RESOURCE_PATH:-}"
  fi
done

export HOME="${ROBOTICS_HOME:-/tmp/ros-home}"
mkdir -p "${HOME}/.ros"
export ROS_HOME="${HOME}/.ros"
export ROS_LOG_DIR="${HOME}/.ros/log"
# shellcheck disable=SC1090
source "${ROBOTICS_ROS_SETUP:-/opt/ros/jazzy/setup.bash}"

PACKAGE_PREFIX="$(ros2 pkg prefix "${PACKAGE}" 2>/dev/null)" || {
  echo "error: ROS package '${PACKAGE}' is not installed in this simulation image" >&2
  exit 1
}
LAUNCH_PATH="${PACKAGE_PREFIX}/share/${PACKAGE}/${LAUNCH_FILE}"
if [[ ! -f "${LAUNCH_PATH}" ]]; then
  echo "error: launch file '${LAUNCH_FILE}' was not found in installed package '${PACKAGE}'" >&2
  exit 1
fi

if "${VALIDATE_ONLY}"; then
  echo "Robot launch configuration is available: ${PACKAGE}/${LAUNCH_FILE}"
  exit 0
fi

# `ros2 launch <package>` searches the package's launch directory itself; pass
# its basename after the explicit preflight above, even when the user supplied
# a relative path such as `launch/spawn_tb3.launch.py`.
exec ros2 launch "${PACKAGE}" "$(basename "${LAUNCH_FILE}")" "$@"
