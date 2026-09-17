#!/usr/bin/env bash
# Shared input validation for Physical AI sim entrypoints.
# Patterns MUST stay aligned with packages/shared/src/security/simInput.ts

# Robot / Gazebo model / ROS namespace: letter, then alnum/_/- (max 64).
pai_validate_robot_name() {
  local name="${1:-}"
  if [[ ! "${name}" =~ ^[a-zA-Z][a-zA-Z0-9_-]{0,63}$ ]]; then
    echo "error: invalid robot name '${name}' (use letters, digits, underscore, hyphen; max 64; must start with a letter)" >&2
    return 1
  fi
}

# Numeric pose / duration (optional leading minus, optional fraction).
pai_validate_numeric() {
  local value="${1:-}"
  local label="${2:-value}"
  if [[ ! "${value}" =~ ^-?[0-9]+([.][0-9]+)?$ ]]; then
    echo "error: invalid ${label} '${value}' (must be a number)" >&2
    return 1
  fi
}

# Absolute ROS topic: /segment[/segment...]
pai_validate_topic_name() {
  local name="${1:-}"
  if [[ ! "${name}" =~ ^(/[a-zA-Z][a-zA-Z0-9_]*)+$ ]]; then
    echo "error: invalid ROS topic name '${name}'" >&2
    return 1
  fi
}

# World / identifier used in paths and grep: same as robot name rules.
pai_validate_identifier() {
  local name="${1:-}"
  local label="${2:-identifier}"
  if [[ ! "${name}" =~ ^[a-zA-Z][a-zA-Z0-9_-]{0,63}$ ]]; then
    echo "error: invalid ${label} '${name}'" >&2
    return 1
  fi
}

# TCP port 1–65535.
pai_validate_port() {
  local value="${1:-}"
  local label="${2:-port}"
  if [[ ! "${value}" =~ ^[0-9]+$ ]] || (( value < 1 || value > 65535 )); then
    echo "error: invalid ${label} '${value}' (1-65535)" >&2
    return 1
  fi
}

# Single ROBOTS spec: name:x:y:yaw
pai_validate_robot_spec() {
  local spec="${1:-}"
  local rname rx ry ryaw
  IFS=: read -r rname rx ry ryaw <<< "${spec}"
  if [[ -z "${rname}" || -z "${rx}" || -z "${ry}" ]]; then
    echo "error: invalid ROBOTS spec '${spec}' (expected name:x:y:yaw)" >&2
    return 1
  fi
  pai_validate_robot_name "${rname}" || return 1
  pai_validate_numeric "${rx}" "x" || return 1
  pai_validate_numeric "${ry}" "y" || return 1
  pai_validate_numeric "${ryaw:-0.0}" "yaw" || return 1
}

# Space-separated ROBOTS env value.
pai_validate_robots_env() {
  local robots="${1:-}"
  local spec
  [[ -z "${robots}" ]] && return 0
  for spec in ${robots}; do
    pai_validate_robot_spec "${spec}" || return 1
  done
}

# /opt/ros/<distro> from ROBOTICS_ROS_SETUP (default: jazzy preset image).
pai_ros_distro_dir() {
  local setup="${ROBOTICS_ROS_SETUP:-/opt/ros/jazzy/setup.bash}"
  cd "$(dirname "${setup}")" && pwd
}

# Gazebo model lookup for nav2_minimal_tb3_sim worlds (must match the sourced ROS distro).
pai_export_gz_sim_resource_path() {
  local d
  d="$(pai_ros_distro_dir)"
  export GZ_SIM_RESOURCE_PATH="${d}/share:${d}/share/nav2_minimal_tb3_sim/models:${GZ_SIM_RESOURCE_PATH:-}"
}
