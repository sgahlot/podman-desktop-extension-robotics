#!/usr/bin/env python3
"""One bounded, sensor-QoS subscriber; success means a real per-robot scan arrived."""

import argparse
import os
import re
import signal
import sys
import time


def wait_for_scan(robot_name, timeout_seconds):
    # Import only after argument validation. ROS setup must be sourced by the caller.
    import rclpy
    from rclpy.qos import qos_profile_sensor_data
    from rclpy.signals import SignalHandlerOptions
    from sensor_msgs.msg import LaserScan

    deadline = time.monotonic() + timeout_seconds
    received = False
    cancelled = 0
    node = None
    initialized = False

    def on_scan(_message):
        nonlocal received
        received = True

    def cancel(signum, _frame):
        nonlocal cancelled
        cancelled = 128 + signum

    previous = {sig: signal.signal(sig, cancel) for sig in (signal.SIGINT, signal.SIGTERM)}
    try:
        rclpy.init(args=[], signal_handler_options=SignalHandlerOptions.NO)
        initialized = True
        node = rclpy.create_node(
            f"physical_ai_scan_wait_{os.getpid()}",
            enable_rosout=False,
            start_parameter_services=False,
        )
        node.create_subscription(LaserScan, f"/{robot_name}/scan", on_scan, qos_profile_sensor_data)
        while not received and not cancelled and rclpy.ok():
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                break
            rclpy.spin_once(node, timeout_sec=min(0.2, remaining))
        if cancelled:
            return cancelled
        if received:
            print(f"[scan-ready] Received /{robot_name}/scan", flush=True)
            return 0
        print(f"[scan-ready] No /{robot_name}/scan sample within {timeout_seconds:g}s", file=sys.stderr)
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
    parser.add_argument("timeout_seconds", type=int)
    args = parser.parse_args()
    if not re.fullmatch(r"[A-Za-z0-9_][A-Za-z0-9_-]*", args.robot_name):
        parser.error("invalid robot name")
    if not 1 <= args.timeout_seconds <= 300:
        parser.error("timeout must be between 1 and 300 seconds")
    try:
        return wait_for_scan(args.robot_name, args.timeout_seconds)
    except Exception as error:
        print(f"[scan-ready] {error}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
