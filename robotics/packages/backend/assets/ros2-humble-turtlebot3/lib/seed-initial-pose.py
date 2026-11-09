#!/usr/bin/env python3
"""Bounded AMCL initialization with delivery acknowledgement, not a blind one-shot."""

import argparse
import math
import os
import re
import signal
import sys
import time


def seed_initial_pose(robot_name, x, y, timeout_seconds):
    # ROS imports follow CLI validation; setup must be sourced by the caller.
    import rclpy
    from geometry_msgs.msg import PoseWithCovarianceStamped
    from lifecycle_msgs.srv import GetState
    from rclpy.parameter import Parameter
    from rclpy.qos import DurabilityPolicy, QoSProfile, ReliabilityPolicy
    from rclpy.signals import SignalHandlerOptions
    from rclpy.time import Time
    from tf2_ros import Buffer, TransformListener

    deadline = time.monotonic() + timeout_seconds
    localized = False
    cancelled = 0
    node = None
    initialized = False

    def on_pose(_message):
        nonlocal localized
        localized = True

    def cancel(signum, _frame):
        nonlocal cancelled
        cancelled = 128 + signum

    previous = {sig: signal.signal(sig, cancel) for sig in (signal.SIGINT, signal.SIGTERM)}
    try:
        rclpy.init(args=[], signal_handler_options=SignalHandlerOptions.NO)
        initialized = True
        node = rclpy.create_node(
            f"physical_ai_pose_seed_{os.getpid()}",
            cli_args=["--ros-args", "-r", f"/tf:=/{robot_name}/tf", "-r", f"/tf_static:=/{robot_name}/tf_static"],
            parameter_overrides=[Parameter("use_sim_time", value=True)],
            enable_rosout=False,
            start_parameter_services=False,
        )
        # AMCL retains its latest pose. Seeing an existing localization also means
        # a delayed helper must not reset a robot which is already navigating.
        qos = QoSProfile(depth=1, reliability=ReliabilityPolicy.RELIABLE,
                         durability=DurabilityPolicy.TRANSIENT_LOCAL)
        node.create_subscription(PoseWithCovarianceStamped, f"/{robot_name}/amcl_pose", on_pose, qos)
        publisher = node.create_publisher(PoseWithCovarianceStamped, f"/{robot_name}/initialpose", qos)
        lifecycle = node.create_client(GetState, f"/{robot_name}/amcl/get_state")
        buffer = Buffer()
        listener = TransformListener(buffer, node)
        state = None
        active = False
        next_state_check = 0.0
        next_publish = 0.0
        attempts = 0
        while not cancelled and rclpy.ok():
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                break
            rclpy.spin_once(node, timeout_sec=min(0.1, remaining))
            if cancelled:
                break
            if localized or buffer.can_transform("map", "base_footprint", Time()):
                print(f"[pose-seed] AMCL localization acknowledged for {robot_name} ({attempts} publications)", flush=True)
                return 0
            now = time.monotonic()
            if state is not None and state.done():
                response = state.result()
                active = response is not None and response.current_state.id == 3
                state = None
            if state is None and now >= next_state_check and lifecycle.service_is_ready():
                state = lifecycle.call_async(GetState.Request())
                next_state_check = now + 1.0
            if (not active or publisher.get_subscription_count() < 1 or
                    node.get_clock().now().nanoseconds == 0 or
                    not buffer.can_transform("odom", "base_footprint", Time()) or now < next_publish):
                continue
            message = PoseWithCovarianceStamped()
            message.header.frame_id = "map"
            message.pose.pose.position.x = x
            message.pose.pose.position.y = y
            message.pose.pose.orientation.w = 1.0
            message.pose.covariance[0] = message.pose.covariance[7] = 0.25
            message.pose.covariance[35] = 0.06853891909122467
            publisher.publish(message)
            attempts += 1
            next_publish = now + 2.0
            print(f"[pose-seed] Published initial pose for {robot_name} (attempt {attempts}); waiting for AMCL acknowledgement", flush=True)
        if cancelled:
            return cancelled
        print(f"[pose-seed] AMCL did not acknowledge localization for {robot_name} within {timeout_seconds:g}s", file=sys.stderr)
        return 1
    finally:
        if node is not None:
            node.destroy_node()
        if initialized:
            rclpy.try_shutdown()
        for sig, handler in previous.items():
            signal.signal(sig, handler)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("robot_name")
    parser.add_argument("x", type=float)
    parser.add_argument("y", type=float)
    parser.add_argument("timeout_seconds", type=int)
    args = parser.parse_args()
    if not re.fullmatch(r"[A-Za-z0-9_][A-Za-z0-9_-]*", args.robot_name):
        parser.error("invalid robot name")
    if not all(math.isfinite(value) for value in (args.x, args.y)):
        parser.error("pose coordinates must be finite")
    if not 1 <= args.timeout_seconds <= 300:
        parser.error("timeout must be between 1 and 300 seconds")
    try:
        return seed_initial_pose(args.robot_name, args.x, args.y, args.timeout_seconds)
    except Exception as error:
        print(f"[pose-seed] {error}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
