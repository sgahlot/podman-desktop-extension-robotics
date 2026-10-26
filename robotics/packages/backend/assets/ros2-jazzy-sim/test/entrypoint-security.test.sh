#!/usr/bin/env bash
# Stub-based security tests for jazzy-sim entrypoints + validate-input.sh.
# No Podman / ROS install required — validation runs before sourcing ROS.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
VALIDATE="${ROOT}/lib/validate-input.sh"
SPAWN="${ROOT}/entrypoint-spawn-robot.sh"
LAUNCH="${ROOT}/entrypoint-launch-robot.sh"
EMBEDDED_SPAWN="${ROOT}/entrypoint-spawn-embedded-robot.sh"
NAV2="${ROOT}/entrypoint-nav2.sh"
GAZEBO="${ROOT}/entrypoint-gazebo.sh"

# shellcheck source=../lib/validate-input.sh
source "${VALIDATE}"

pass=0
fail=0

assert_ok() {
  local desc="$1"
  shift
  if "$@" >/dev/null 2>&1; then
    echo "PASS: ${desc}"
    pass=$((pass + 1))
  else
    echo "FAIL: ${desc}"
    fail=$((fail + 1))
  fi
}

assert_fail() {
  local desc="$1"
  shift
  if "$@" >/dev/null 2>&1; then
    echo "FAIL: ${desc} (expected failure)"
    fail=$((fail + 1))
  else
    echo "PASS: ${desc}"
    pass=$((pass + 1))
  fi
}

echo "=== validate-input.sh helpers ==="
assert_ok "accepts robot_1" pai_validate_robot_name "robot_1"
assert_ok "accepts tb3-waffle" pai_validate_robot_name "tb3-waffle"
assert_fail "rejects robot;id" pai_validate_robot_name "robot;id"
assert_fail "rejects \$(id)" pai_validate_robot_name '$(id)'
assert_fail "rejects path traversal" pai_validate_robot_name '../etc'
assert_fail "rejects empty robot" pai_validate_robot_name ""

assert_ok "accepts numeric -2.0" pai_validate_numeric "-2.0" "x"
assert_fail "rejects numeric with semicolon" pai_validate_numeric "1;id" "x"

assert_ok "accepts topic /robot_1/cmd_vel" pai_validate_topic_name "/robot_1/cmd_vel"
assert_fail "rejects injectable topic" pai_validate_topic_name "/cmd_vel; id"

assert_ok "accepts ROBOTS spec" pai_validate_robot_spec "robot_1:-2.0:0.5:0.0"
assert_fail "rejects bad ROBOTS spec name" pai_validate_robot_spec "robot;x:0:0:0"
assert_fail "rejects bad ROBOTS env" pai_validate_robots_env "robot_1:0:0:0 bad;name:1:2:3"

echo
echo "=== entrypoint-spawn-robot.sh (rejects before ROS) ==="
assert_fail "spawn rejects robot;id" \
  env ROBOTICS_VALIDATE_LIB="${VALIDATE}" "${SPAWN}" "robot;id" 0 0 0
assert_fail "spawn rejects non-numeric x" \
  env ROBOTICS_VALIDATE_LIB="${VALIDATE}" "${SPAWN}" "robot_1" "0;rm" 0 0
assert_fail "spawn rejects missing args" \
  env ROBOTICS_VALIDATE_LIB="${VALIDATE}" "${SPAWN}"

echo
echo "=== entrypoint-launch-robot.sh (rejects before ROS) ==="
assert_fail "launch rejects injectable package" \
  env ROBOTICS_VALIDATE_LIB="${VALIDATE}" "${LAUNCH}" 'robot;id' spawn.launch.py --validate
assert_fail "launch rejects traversal" \
  env ROBOTICS_VALIDATE_LIB="${VALIDATE}" "${LAUNCH}" robot_sim ../spawn.launch.py --validate
assert_fail "launch rejects injectable argument" \
  env ROBOTICS_VALIDATE_LIB="${VALIDATE}" "${LAUNCH}" robot_sim spawn.launch.py 'name;id:=robot'

echo
echo "=== entrypoint-spawn-embedded-robot.sh (rejects before ROS) ==="
assert_fail "embedded spawn rejects an invalid robot name" \
  env ROBOTICS_VALIDATE_LIB="${VALIDATE}" "${EMBEDDED_SPAWN}" 'robot;id' tb3_sandbox /opt/physical-ai/robots/boxbot/model.sdf 0 0 0 0
assert_fail "embedded spawn rejects an invalid world" \
  env ROBOTICS_VALIDATE_LIB="${VALIDATE}" "${EMBEDDED_SPAWN}" robot_1 'tb3;sandbox' /opt/physical-ai/robots/boxbot/model.sdf 0 0 0 0
assert_fail "embedded spawn rejects path traversal" \
  env ROBOTICS_VALIDATE_LIB="${VALIDATE}" "${EMBEDDED_SPAWN}" robot_1 tb3_sandbox /opt/physical-ai/robots/boxbot/../outside.sdf 0 0 0 0
assert_fail "embedded spawn rejects a non-numeric pose" \
  env ROBOTICS_VALIDATE_LIB="${VALIDATE}" "${EMBEDDED_SPAWN}" robot_1 tb3_sandbox /opt/physical-ai/robots/boxbot/model.sdf '0;id' 0 0 0

echo
echo "=== ROS setup compatibility with nounset ==="
setup_dir="$(mktemp -d)"
trap 'rm -rf "${setup_dir}"' EXIT
mock_setup="${setup_dir}/setup.bash"
printf '%s\n' ': "${AMENT_TRACE_SETUP_FILES}"' 'export PAI_TEST_ROS_SETUP_SOURCED=true' > "${mock_setup}"
if env -u AMENT_TRACE_SETUP_FILES ROBOTICS_ROS_SETUP="${mock_setup}" bash -c \
  'set -euo pipefail; source "$1"; pai_source_ros_setup; [[ "${PAI_TEST_ROS_SETUP_SOURCED}" == "true" ]]' \
  _ "${ROOT}/lib/load-validate-input.sh"; then
  echo "PASS: ROS setup sources with unset AMENT_TRACE_SETUP_FILES under nounset"
  pass=$((pass + 1))
else
  echo "FAIL: ROS setup sources with unset AMENT_TRACE_SETUP_FILES under nounset"
  fail=$((fail + 1))
fi
rm -rf "${setup_dir}"
trap - EXIT

echo
echo "=== entrypoint-nav2.sh (rejects before ROS) ==="
assert_fail "nav2 rejects robot;id" \
  env ROBOTICS_VALIDATE_LIB="${VALIDATE}" "${NAV2}" "robot;id"
assert_fail "nav2 rejects empty" \
  env ROBOTICS_VALIDATE_LIB="${VALIDATE}" "${NAV2}"

echo
echo "=== entrypoint-gazebo.sh (rejects hostile env before display/ROS) ==="
assert_fail "gazebo rejects injectable ROBOTS" \
  env ROBOTICS_VALIDATE_LIB="${VALIDATE}" ROBOTS='robot;x:0:0:0' "${GAZEBO}"
assert_fail "gazebo rejects bad WORLD_NAME" \
  env ROBOTICS_VALIDATE_LIB="${VALIDATE}" WORLD_NAME='tb3;sandbox' "${GAZEBO}"
assert_fail "gazebo rejects bad NOVNC_PORT" \
  env ROBOTICS_VALIDATE_LIB="${VALIDATE}" NOVNC_PORT='6080;id' "${GAZEBO}"
assert_fail "gazebo rejects bad RESOLUTION" \
  env ROBOTICS_VALIDATE_LIB="${VALIDATE}" RESOLUTION='1024x768' "${GAZEBO}"
assert_fail "spawn rejects missing validate lib override" \
  env ROBOTICS_VALIDATE_LIB="/nonexistent/validate-input.sh" "${SPAWN}" robot_1 0 0 0

echo
echo "Results: ${pass} passed, ${fail} failed"
if (( fail > 0 )); then
  exit 1
fi
