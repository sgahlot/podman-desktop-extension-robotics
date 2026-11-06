#!/usr/bin/env python3
"""In-image functional probe; run explicitly, not in the container-free suite."""

import math
import re
import subprocess
import sys
import time

import rclpy
from action_msgs.msg import GoalStatus
from nav2_msgs.action import NavigateToPose
from lifecycle_msgs.srv import GetState
from nav_msgs.msg import Odometry
from rclpy.action import ActionClient
from rclpy.node import Node
from rclpy.qos import qos_profile_sensor_data
from rclpy.time import Time
from rosgraph_msgs.msg import Clock
from sensor_msgs.msg import Imu, LaserScan
from tf2_ros import Buffer, TransformListener


def wait(node, condition, seconds, label):
    deadline = time.monotonic() + seconds
    while time.monotonic() < deadline:
        rclpy.spin_once(node, timeout_sec=0.1)
        if condition():
            return
    raise RuntimeError(f"timed out: {label}")


def main():
    phase = sys.argv[1]
    robot = sys.argv[2] if len(sys.argv) > 2 else "robot_test"
    goal_x = float(sys.argv[3]) if len(sys.argv) > 3 else -1.0
    goal_y = float(sys.argv[4]) if len(sys.argv) > 4 else -0.5
    rclpy.init(args=[])
    node = Node("humble_parity_probe", cli_args=[
        "--ros-args", "-r", f"/tf:=/{robot}/tf", "-r", f"/tf_static:=/{robot}/tf_static",
    ])
    buffer = Buffer()
    listener = TransformListener(buffer, node)
    samples = {"clock": [], "scan": [], "imu": [], "odom": []}
    subscriptions = []
    clock_state = {"last": None, "count": 0, "advanced": False, "received": time.monotonic()}

    def clock_sample(msg):
        stamp = msg.clock.sec * 1_000_000_000 + msg.clock.nanosec
        previous = clock_state["last"]
        assert previous is None or stamp >= previous, f"clock stepped backwards: {previous} -> {stamp}"
        clock_state["advanced"] |= previous is not None and stamp > previous
        clock_state["last"] = stamp
        clock_state["count"] += 1
        clock_state["received"] = time.monotonic()

    def clock_owner():
        publishers = node.get_publishers_info_by_topic("/clock")
        return (len(publishers) == 1 and publishers[0].node_name == "physical_ai_clock_bridge"
                and publishers[0].node_namespace == "/")

    subscriptions.append(node.create_subscription(Clock, "/clock", clock_sample, qos_profile_sensor_data))
    for name, topic, msg_type in [
        ("clock", "/clock", Clock), ("scan", f"/{robot}/scan", LaserScan),
        ("imu", f"/{robot}/imu", Imu), ("odom", f"/{robot}/odom", Odometry),
    ]:
        if phase == "clock" and name != "clock":
            continue
        subscriptions.append(node.create_subscription(
            msg_type, topic, lambda msg, key=name: samples[key].append(msg) if len(samples[key]) < 100 else None,
            qos_profile_sensor_data,
        ))
    try:
        wait(node, lambda: clock_owner() and clock_state["advanced"], 30, "one simulation-owned advancing clock")

        def check_clock_owner():
            assert clock_owner(), "expected exactly one simulation-owned /clock publisher"
            assert time.monotonic() - clock_state["received"] < 10, "simulation clock stalled"

        clock_timer = node.create_timer(1.0, check_clock_owner)
        if phase == "clock":
            start = time.monotonic()
            count = clock_state["count"]
            last = clock_state["last"]
            wait(node, lambda: time.monotonic() - start >= 10, 15, "10s singleton clock observation")
            assert clock_state["count"] > count + 1 and clock_state["last"] > last, "clock stopped"
            print("PASS: single world-owned clock, advancing without backwards steps for 10s", flush=True)
            return
        wait(node, lambda: all(len(value) >= 2 for value in samples.values()), 120, "clock/scan/IMU/odom samples")
        stamps = [msg.clock.sec * 1_000_000_000 + msg.clock.nanosec for msg in samples["clock"]]
        assert max(stamps) > min(stamps), "simulation clock did not advance"
        scan = samples["scan"][-1]
        assert scan.ranges and scan.header.frame_id, "empty/unframed lidar scan"
        assert any(math.isfinite(value) and value > 0 for value in scan.ranges), "lidar has no finite returns"
        wait(node, lambda: buffer.can_transform("odom", "base_footprint", Time()), 30, "odom -> base_footprint TF")
        print("PASS: advancing clock, scan/IMU/odom samples, odom TF", flush=True)
        if phase == "sensors":
            return
        assert phase == "navigation", "expected sensors or navigation"
        wait(node, lambda: buffer.can_transform("map", "base_footprint", Time()), 120, "localized map TF")
        initial = buffer.lookup_transform("map", "base_footprint", Time()).transform.translation
        client = ActionClient(node, NavigateToPose, f"/{robot}/navigate_to_pose")
        wait(node, client.server_is_ready, 60, "Nav2 action server")
        # Action discovery and AMCL TF can precede bt_navigator activation.
        # Wait for its lifecycle state instead of sending a premature goal.
        lifecycle = node.create_client(GetState, f"/{robot}/bt_navigator/get_state")
        wait(node, lifecycle.service_is_ready, 60, "navigator lifecycle service")
        deadline = time.monotonic() + 60
        while True:
            state = lifecycle.call_async(GetState.Request())
            wait(node, state.done, 10, "navigator lifecycle response")
            if state.result().current_state.id == 3:
                break
            assert time.monotonic() < deadline, "bt_navigator never became active"
            # Keep spinning so TF updates and lifecycle transitions can complete.
            rclpy.spin_once(node, timeout_sec=0.5)
        # Exercise the exact lifecycle CLI contract used by the extension's
        # shared readiness gate, not only the service used by this ROS node.
        lifecycle_cli = subprocess.run(
            ["timeout", "5", "ros2", "lifecycle", "get", f"/{robot}/bt_navigator"],
            capture_output=True, text=True, timeout=10, check=True,
        )
        assert re.search(r"^active\s+\[3\]\s*$", lifecycle_cli.stdout, re.MULTILINE), lifecycle_cli.stdout
        goal = NavigateToPose.Goal()
        goal.pose.header.frame_id = "map"
        goal.pose.pose.position.x = goal_x
        goal.pose.pose.position.y = goal_y
        goal.pose.pose.orientation.w = 1.0
        request = client.send_goal_async(goal)
        wait(node, request.done, 30, "navigation goal acceptance")
        handle = request.result()
        assert handle.accepted, "Nav2 rejected goal"
        result = handle.get_result_async()
        wait(node, result.done, 180, "successful navigation result")
        assert result.result().status == GoalStatus.STATUS_SUCCEEDED, f"navigation status: {result.result().status}"
        final = buffer.lookup_transform("map", "base_footprint", Time()).transform.translation
        assert math.hypot(final.x - initial.x, final.y - initial.y) > 0.15, "goal succeeded without observed motion"
        assert math.hypot(final.x - goal_x, final.y - goal_y) < 0.35, "final TF pose is not near requested goal"
        print("PASS: localized map TF, active navigator lifecycle CLI, Nav2 action SUCCEEDED, observed motion and final pose", flush=True)
    finally:
        node.destroy_node()
        rclpy.shutdown()


if __name__ == "__main__":
    main()
