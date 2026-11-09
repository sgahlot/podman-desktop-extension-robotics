#!/usr/bin/env python3
"""Bounded subscriber regression tests without ROS or a running simulation."""

import importlib.util
import pathlib
import signal
import subprocess
import sys
import types
import unittest
from unittest.mock import Mock, patch

ROOT = pathlib.Path(__file__).resolve().parent.parent
HELPER = ROOT / "lib/wait-for-scan.py"
SPEC = importlib.util.spec_from_file_location("wait_for_scan", HELPER)
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)


class ScanWaitTests(unittest.TestCase):
    def setUp(self):
        self.clock = 0.0
        self.callback = None
        self.node = Mock()
        self.node.create_subscription.side_effect = self.subscribe
        self.ros = types.ModuleType("rclpy")
        self.ros.init = Mock()
        self.ros.create_node = Mock(return_value=self.node)
        self.ros.ok = Mock(return_value=True)
        self.ros.try_shutdown = Mock()
        self.ros.spin_once = Mock(side_effect=self.spin)
        self.qos = types.ModuleType("rclpy.qos")
        self.qos.qos_profile_sensor_data = object()
        signals = types.ModuleType("rclpy.signals")
        signals.SignalHandlerOptions = types.SimpleNamespace(NO=0)
        self.messages = types.ModuleType("sensor_msgs.msg")
        self.messages.LaserScan = object()
        modules = patch.dict(sys.modules, {
            "rclpy": self.ros, "rclpy.qos": self.qos, "rclpy.signals": signals,
            "sensor_msgs": types.ModuleType("sensor_msgs"), "sensor_msgs.msg": self.messages,
        })
        modules.start()
        self.addCleanup(modules.stop)
        clock = patch.object(MODULE.time, "monotonic", side_effect=lambda: self.clock)
        clock.start()
        self.addCleanup(clock.stop)

    def subscribe(self, _message_type, _topic, callback, _qos):
        self.callback = callback

    def spin(self, _node, timeout_sec):
        self.clock += timeout_sec

    def test_delayed_sample_keeps_one_subscriber_beyond_old_two_second_limit(self):
        def delayed(node, timeout_sec):
            self.spin(node, timeout_sec)
            if self.clock >= 4:
                self.callback(object())
        self.ros.spin_once.side_effect = delayed
        self.assertEqual(MODULE.wait_for_scan("robot_1", 5), 0)
        self.assertGreaterEqual(self.clock, 4)
        self.ros.init.assert_called_once_with(args=[], signal_handler_options=0)
        self.ros.create_node.assert_called_once()
        self.node.create_subscription.assert_called_once_with(
            self.messages.LaserScan, "/robot_1/scan", self.callback, self.qos.qos_profile_sensor_data,
        )
        self.node.destroy_node.assert_called_once()
        self.ros.try_shutdown.assert_called_once()

    def test_no_sample_is_a_bounded_failure_not_readiness(self):
        self.assertEqual(MODULE.wait_for_scan("robot_1", 3), 1)
        self.assertAlmostEqual(self.clock, 3)
        self.node.create_subscription.assert_called_once()
        self.node.destroy_node.assert_called_once()
        self.ros.try_shutdown.assert_called_once()

    def test_signals_cancel_and_cleanup_without_success(self):
        for sig in (signal.SIGINT, signal.SIGTERM):
            with self.subTest(signal=sig):
                previous = signal.getsignal(sig)
                self.ros.spin_once.side_effect = lambda *_args, **_kwargs: signal.getsignal(sig)(sig, None)
                self.assertEqual(MODULE.wait_for_scan("robot_1", 30), 128 + sig)
                self.assertEqual(signal.getsignal(sig), previous)
        self.assertEqual(self.node.destroy_node.call_count, 2)
        self.assertEqual(self.ros.try_shutdown.call_count, 2)

    def test_subscription_failure_still_releases_ros_resources(self):
        self.node.create_subscription.side_effect = RuntimeError("DDS failure")
        with self.assertRaisesRegex(RuntimeError, "DDS failure"):
            MODULE.wait_for_scan("robot_1", 5)
        self.node.destroy_node.assert_called_once()
        self.ros.try_shutdown.assert_called_once()

    def test_context_shutdown_without_sample_is_not_ready(self):
        self.ros.ok.return_value = False
        self.assertEqual(MODULE.wait_for_scan("robot_1", 5), 1)

    def test_arguments_fail_before_importing_ros(self):
        for robot, timeout in [("robot;id", "5"), ("robot/scan", "5"), ("robot_1", "0"),
                               ("robot_1", "301"), ("robot_1", "nan")]:
            with self.subTest(robot=robot, timeout=timeout):
                result = subprocess.run([sys.executable, "-B", str(HELPER), robot, timeout], capture_output=True)
                self.assertEqual(result.returncode, 2)
                self.assertNotIn(b"No module named", result.stderr)


if __name__ == "__main__":
    unittest.main()
