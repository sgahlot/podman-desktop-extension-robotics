#!/bin/bash
set -e

source /opt/ros/humble/setup.bash
source /root/turtlebot3_ws/install/setup.bash

exec "$@"
