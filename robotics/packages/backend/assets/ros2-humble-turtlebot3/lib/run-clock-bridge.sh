#!/usr/bin/env bash
# One world-owned clock writer; robot removal must never terminate this process.
set -eo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/load-validate-input.sh"
WORLD_NAME="${1:?Usage: run-clock-bridge.sh <world>}"
pai_validate_identifier "${WORLD_NAME}" "WORLD_NAME"

# ROS setup scripts are not safe under nounset.
source "${ROBOTICS_ROS_SETUP:-/opt/ros/humble/setup.bash}"
BRIDGE_BIN="$(ros2 pkg prefix ros_gz_bridge)/lib/ros_gz_bridge/parameter_bridge"
# Use the canonical world clock, not Gazebo's optional /clock alias. This bridge
# supplies simulation time; it must not itself wait for simulation time.
exec "${BRIDGE_BIN}" \
  "/world/${WORLD_NAME}/clock@rosgraph_msgs/msg/Clock[gz.msgs.Clock" \
  --ros-args \
  -r __node:=physical_ai_clock_bridge \
  -r "/world/${WORLD_NAME}/clock:=/clock" \
  -p use_sim_time:=false
