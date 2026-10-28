#!/usr/bin/env bash
# Small deterministic CompressedImage source for Topic Monitor preview validation.
# It is intentionally independent of the TurtleBot3 model and Gazebo bridges.
set -eo pipefail

source "${ROBOTICS_ROS_SETUP:-/opt/ros/jazzy/setup.bash}"

exec python3 - <<'PY'
import base64

import rclpy
from rclpy.qos import qos_profile_sensor_data
from sensor_msgs.msg import CompressedImage

TOPIC = '/physical_ai/test_camera/compressed'
# A valid 1 × 1 PNG. The header timestamp changes once per second, proving the
# preview receives a continuous stream while keeping the test payload tiny.
PNG = base64.b64decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScL6pQAAAABJRU5ErkJggg==')

rclpy.init()
node = rclpy.create_node('physical_ai_test_camera')
publisher = node.create_publisher(CompressedImage, TOPIC, qos_profile_sensor_data)

def publish():
    message = CompressedImage()
    message.header.stamp = node.get_clock().now().to_msg()
    message.header.frame_id = 'physical_ai_test_camera'
    message.format = 'png'
    message.data = PNG
    publisher.publish(message)

timer = node.create_timer(1.0, publish)
publish()
try:
    rclpy.spin(node)
finally:
    node.destroy_timer(timer)
    node.destroy_node()
    rclpy.shutdown()
PY
