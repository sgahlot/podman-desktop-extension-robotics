#!/usr/bin/env bash
# Locate and source validate-input.sh (same directory as this file, or ROBOTICS_VALIDATE_LIB).
# Entrypoints source this loader from repo lib/ or /usr/local/lib/robotics/.
#
# Override: ROBOTICS_VALIDATE_LIB=/path/to/validate-input.sh

_pai_here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
_pai_validate="${ROBOTICS_VALIDATE_LIB:-${_pai_here}/validate-input.sh}"

if [[ ! -f "${_pai_validate}" ]]; then
  echo "error: validate-input.sh not found at '${_pai_validate}'" >&2
  return 1 2>/dev/null || exit 1
fi

# shellcheck source=validate-input.sh
source "${_pai_validate}"
unset _pai_here _pai_validate

# ROS setup files may expand variables that are unset in a clean container
# environment (for example AMENT_TRACE_SETUP_FILES). Preserve the caller's
# nounset policy, but disable it while the upstream setup script is sourced.
pai_source_ros_setup() {
  local setup="${ROBOTICS_ROS_SETUP:-/opt/ros/jazzy/setup.bash}"
  set +u
  # shellcheck disable=SC1090
  source "${setup}"
  set -u
}
