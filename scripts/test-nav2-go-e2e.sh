#!/usr/bin/env bash
# APPENG-5981: End-to-end Nav2 Go path (mirrors backend sendNavigationGoal on Jazzy)
#
# Prerequisites:
#   - Running pai-sim-* container from ros2-jazzy-sim image (rebuilt after APPENG-5980 fixes)
#   - robot_1 spawned (Simulation page → Add TurtleBot3)
#
# Usage:
#   ./scripts/test-nav2-go-e2e.sh [container_id] [goal_x] [goal_y]
#
# Defaults: goal (1.0, 1.0) — reachable on tb3_sandbox without leaving the map.
set -euo pipefail

CONTAINER_ID="${1:-}"
GOAL_X="${2:-1.0}"
GOAL_Y="${3:-1.0}"
ROBOT_NAME="${ROBOT_NAME:-robot_1}"
MAX_WAIT_SEC="${MAX_WAIT_SEC:-90}"

if [[ -z "${CONTAINER_ID}" ]]; then
  CONTAINER_ID="$(
    podman ps --format '{{.ID}} {{.Names}}' \
      | awk '$2 ~ /^pai-sim-/ { print $1; exit }'
  )"
fi

if [[ -z "${CONTAINER_ID}" ]]; then
  echo "ERROR: no running simulation container found (expected name pai-sim-*)"
  exit 1
fi

ros_exec() {
  podman exec "${CONTAINER_ID}" /bin/bash -lc "source /opt/ros/jazzy/setup.bash && $*"
}

echo "== APPENG-5981 Nav2 Go E2E =="
echo "Container: ${CONTAINER_ID}"
echo "Robot:     ${ROBOT_NAME}"
echo "Goal:      (${GOAL_X}, ${GOAL_Y})"
echo

POSE_OUT="$(ros_exec "gz model -m ${ROBOT_NAME} -p 2>/dev/null" || true)"
if ! printf '%s\n' "${POSE_OUT}" | rg -q '\[.*\]'; then
  echo "ERROR: could not read pose for ${ROBOT_NAME}. Spawn the robot first."
  exit 1
fi

SPAWN_X="$(printf '%s\n' "${POSE_OUT}" | rg -o -- '-?[0-9]+\.[0-9]+' | sed -n '1p')"
SPAWN_Y="$(printf '%s\n' "${POSE_OUT}" | rg -o -- '-?[0-9]+\.[0-9]+' | sed -n '2p')"
echo "Current pose: (${SPAWN_X}, ${SPAWN_Y})"
echo

if ! ros_exec "ros2 topic list 2>/dev/null" | rg -q "/${ROBOT_NAME}/cmd_vel"; then
  echo "ERROR: /${ROBOT_NAME}/cmd_vel not found — is ${ROBOT_NAME} spawned?"
  exit 1
fi

if ! ros_exec "ros2 action list 2>/dev/null" | rg -q "/${ROBOT_NAME}/navigate_to_pose"; then
  echo "Nav2 not running — launching /entrypoint-nav2.sh (AMCL seed: ${SPAWN_X}, ${SPAWN_Y})..."
  podman exec -d \
    -e "PHYSICAL_AI_SPAWN_X=${SPAWN_X}" \
    -e "PHYSICAL_AI_SPAWN_Y=${SPAWN_Y}" \
    "${CONTAINER_ID}" \
    /entrypoint-nav2.sh "${ROBOT_NAME}"

  ready=0
  for ((i = 1; i <= MAX_WAIT_SEC; i++)); do
    if ros_exec "ros2 action list 2>/dev/null" | rg -q "/${ROBOT_NAME}/navigate_to_pose"; then
      ready=1
      echo "Nav2 action server ready after ${i}s."
      break
    fi
    sleep 1
  done
  if [[ "${ready}" -ne 1 ]]; then
    echo "ERROR: Nav2 did not expose /${ROBOT_NAME}/navigate_to_pose within ${MAX_WAIT_SEC}s"
    exit 1
  fi
  echo "Waiting 15s for AMCL initial pose..."
  sleep 15
else
  echo "Nav2 already running (/navigate_to_pose present)."
fi

echo "Checking map→base_link TF before sending goal..."
tf_ready=0
for ((i = 1; i <= 30; i++)); do
  TF_OUT="$(
    ros_exec "timeout 5 ros2 run tf2_ros tf2_echo map base_link --ros-args -p use_sim_time:=true -r /tf:=/${ROBOT_NAME}/tf -r /tf_static:=/${ROBOT_NAME}/tf_static 2>&1" || true
  )"
  if printf '%s\n' "${TF_OUT}" | rg -q 'Translation:'; then
    tf_ready=1
    echo "map→base_link TF ready (attempt ${i})."
    break
  fi
  sleep 1
done
if [[ "${tf_ready}" -ne 1 ]]; then
  echo "ERROR: map→base_link TF not available within 30s"
  exit 1
fi

echo
echo "--- Sending navigate_to_pose goal ---"
TARGET_YAW="$(python3 - <<PY
import math
x0, y0 = float("${SPAWN_X}"), float("${SPAWN_Y}")
x1, y1 = float("${GOAL_X}"), float("${GOAL_Y}")
print(math.atan2(y1 - y0, x1 - x0))
PY
)"
QZ="$(python3 - <<PY
import math
yaw = float("${TARGET_YAW}")
print(math.sin(yaw / 2))
PY
)"
QW="$(python3 - <<PY
import math
yaw = float("${TARGET_YAW}")
print(math.cos(yaw / 2))
PY
)"

set +e
GOAL_OUT="$(
  ros_exec "timeout 180 ros2 action send_goal /${ROBOT_NAME}/navigate_to_pose nav2_msgs/action/NavigateToPose \
    \"{pose: {header: {frame_id: map}, pose: {position: {x: ${GOAL_X}, y: ${GOAL_Y}, z: 0.0}, orientation: {x: 0.0, y: 0.0, z: ${QZ}, w: ${QW}}}}}\" --feedback" 2>&1
)"
GOAL_RC=$?
set -e

echo "${GOAL_OUT}" | tail -30
echo "Exit code: ${GOAL_RC}"

if printf '%s\n' "${GOAL_OUT}" | rg -qi 'Goal finished with status: SUCCEEDED|Succeed'; then
  FINAL_POSE="$(ros_exec "gz model -m ${ROBOT_NAME} -p 2>/dev/null" || true)"
  FINAL_X="$(printf '%s\n' "${FINAL_POSE}" | rg -o -- '-?[0-9]+\.[0-9]+' | sed -n '1p')"
  FINAL_Y="$(printf '%s\n' "${FINAL_POSE}" | rg -o -- '-?[0-9]+\.[0-9]+' | sed -n '2p')"
  echo
  echo "PASS: Nav2 goal succeeded. Final pose ≈ (${FINAL_X}, ${FINAL_Y})"
  exit 0
fi

echo
echo "FAIL: Nav2 goal did not succeed."
exit 1
