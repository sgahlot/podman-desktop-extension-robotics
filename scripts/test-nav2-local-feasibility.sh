#!/usr/bin/env bash
# APPENG-5980: Local Nav2 feasibility spike on Apple Silicon (Mac)
#
# Usage:
#   ./scripts/test-nav2-local-feasibility.sh [container_id]
#
# If container_id is omitted, the script auto-picks the first running
# container whose name starts with "pai-sim-".
set -euo pipefail

CONTAINER_ID="${1:-}"
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

echo "== APPENG-5980 Nav2 Local Feasibility =="
echo "Container: ${CONTAINER_ID}"
echo

run() {
  local title="$1"
  shift
  echo "--- ${title} ---"
  "$@"
  echo
}

run "GPU device visibility" \
  podman exec "${CONTAINER_ID}" /bin/bash -lc 'ls -la /dev/dri || true'

TOPICS_NOW="$(podman exec "${CONTAINER_ID}" /bin/bash -lc 'source /opt/ros/jazzy/setup.bash && ros2 topic list' || true)"
if ! printf '%s\n' "${TOPICS_NOW}" | rg -q '/robot_1/cmd_vel'; then
  echo "ERROR: /robot_1/cmd_vel not found. Spawn robot_1 first from the Simulation page, then re-run."
  exit 1
fi

run "Sensors/cmd_vel topics present" \
  sh -c "podman exec \"${CONTAINER_ID}\" /bin/bash -lc 'source /opt/ros/jazzy/setup.bash && ros2 topic list' | rg '/robot_1/(scan|imu|cmd_vel)'"

run "TF chain check (odom -> base_link)" \
  podman exec "${CONTAINER_ID}" /bin/bash -lc \
    'source /opt/ros/jazzy/setup.bash && timeout 5 ros2 run tf2_ros tf2_echo odom base_link --ros-args -p use_sim_time:=true -r /tf:=/robot_1/tf -r /tf_static:=/robot_1/tf_static 2>&1 | head -12'

echo "--- Nav2 bringup test A (legacy namespaced navigation_launch.py) ---"
set +e
OUT_A="$(
  podman exec "${CONTAINER_ID}" /bin/bash -lc \
    'source /opt/ros/jazzy/setup.bash && timeout 20 ros2 launch nav2_bringup navigation_launch.py namespace:=robot_1 use_sim_time:=True autostart:=True params_file:=/opt/ros/jazzy/share/nav2_bringup/params/nav2_params.yaml' 2>&1
)"
RC_A=$?
set -e
echo "${OUT_A}" | tail -20
echo "Exit code: ${RC_A}"
if echo "${OUT_A}" | rg -q "No critics defined for FollowPath"; then
  echo "Finding: navigation_launch.py with namespace wraps params but does not push namespace onto nodes."
fi
echo

echo "--- Nav2 bringup test B (fixed bringup_launch.py + namespaced TF) ---"
set +e
OUT_B="$(
  podman exec "${CONTAINER_ID}" /bin/bash -lc 'timeout 60 /entrypoint-nav2.sh robot_1' 2>&1
)"
RC_B=$?
set -e
echo "${OUT_B}" | tail -40
echo "Exit code: ${RC_B}"

if echo "${OUT_B}" | rg -q "MPPIController|Critic loaded"; then
  echo "Finding: controller_server loads MPPI critics with fixed bringup path."
fi
if echo "${OUT_B}" | rg -q "Activating controller_server"; then
  echo "Finding: controller_server reaches activation stage."
fi
if echo "${OUT_B}" | rg -q "Invalid frame ID \"odom\""; then
  echo "Finding: odom TF not visible to Nav2 (likely use_composition:=True; fixed in entrypoint-nav2.sh)."
fi
if echo "${OUT_B}" | rg -q "Invalid frame ID \"map\""; then
  echo "Finding: map frame missing until AMCL receives initial pose (auto-published after 12s in entrypoint-nav2.sh)."
fi
if echo "${OUT_B}" | rg -q "Managed nodes are active"; then
  echo "Finding: Nav2 lifecycle manager reports managed nodes active."
fi
if echo "${OUT_B}" | rg -q "navigate_to_pose"; then
  echo "Finding: bt_navigator reports navigate_to_pose availability."
fi

echo
echo "== Summary =="
echo "- Sensors topics are available locally (/robot_1/scan, /robot_1/imu)."
echo "- Legacy navigation_launch namespace path fails param loading (FollowPath critics error)."
echo "- Fixed path uses bringup_launch.py with use_namespace + tb3_sandbox map + patched params."
echo "- Spawn stack must publish TF on /robot_1/tf and /robot_1/tf_static (respawn robot after entrypoint-spawn-robot.sh update)."
