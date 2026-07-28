#!/usr/bin/env bash
set -eo pipefail

# Spawn a TurtleBot3 into a running Gazebo simulation.
# Designed to be called via: podman exec <container> /entrypoint-spawn-robot.sh <name> <x> <y> <yaw>
#
# Usage:
#   /entrypoint-spawn-robot.sh robot_1 -2.0 -0.5 0.0
#   /entrypoint-spawn-robot.sh robot_2  2.0  0.5 3.14159

ROBOT_NAME="${1:?Usage: $0 <robot_name> <x> <y> <yaw>}"
X_POSE="${2:?Usage: $0 <robot_name> <x> <y> <yaw>}"
Y_POSE="${3:?Usage: $0 <robot_name> <x> <y> <yaw>}"
YAW="${4:-0.0}"

export HOME="/tmp/ros-home"
mkdir -p "${HOME}/.ros"
export ROS_HOME="${HOME}/.ros"
export ROS_LOG_DIR="${HOME}/.ros/log"

source /opt/ros/jazzy/setup.bash

export TURTLEBOT3_MODEL="${TURTLEBOT3_MODEL:-waffle}"
export GZ_SIM_RESOURCE_PATH="/opt/ros/jazzy/share:/opt/ros/jazzy/share/nav2_minimal_tb3_sim/models:${GZ_SIM_RESOURCE_PATH:-}"

SIM_DIR="/opt/ros/jazzy/share/nav2_minimal_tb3_sim"
URDF_FILE="${SIM_DIR}/urdf/turtlebot3_waffle.urdf"

echo "[spawn] Spawning ${ROBOT_NAME} at (${X_POSE}, ${Y_POSE}, yaw=${YAW})..."

ros2 launch nav2_minimal_tb3_sim spawn_tb3.launch.py \
  use_sim_time:=True \
  namespace:="${ROBOT_NAME}" \
  robot_name:="${ROBOT_NAME}" \
  x_pose:="${X_POSE}" \
  y_pose:="${Y_POSE}" \
  z_pose:=0.01 &
SPAWN_PID=$!

ros2 run robot_state_publisher robot_state_publisher \
  --ros-args \
  --remap __ns:=/"${ROBOT_NAME}" \
  -p use_sim_time:=true \
  -p "robot_description:=$(cat "${URDF_FILE}")" &
RSP_PID=$!

echo "[spawn] ${ROBOT_NAME} spawn initiated. Waiting for processes..."

term_handler() {
  echo "[spawn] Shutting down ${ROBOT_NAME}..."
  kill "${SPAWN_PID}" "${RSP_PID}" 2>/dev/null || true
  wait "${SPAWN_PID}" "${RSP_PID}" 2>/dev/null || true
}

trap term_handler SIGTERM SIGINT

wait "${SPAWN_PID}" "${RSP_PID}"
