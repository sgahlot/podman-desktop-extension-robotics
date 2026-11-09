#!/usr/bin/env python3
"""AMCL acknowledgement regressions without ROS or a running simulator."""

import importlib.util
import pathlib
import signal
import subprocess
import sys
import types
import unittest
from unittest.mock import Mock, patch

ROOT = pathlib.Path(__file__).resolve().parent.parent
HELPER = ROOT / "lib/seed-initial-pose.py"
SPEC = importlib.util.spec_from_file_location("seed_initial_pose", HELPER)
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)


def pose_message():
    return types.SimpleNamespace(
        header=types.SimpleNamespace(frame_id=""),
        pose=types.SimpleNamespace(
            pose=types.SimpleNamespace(position=types.SimpleNamespace(x=0.0, y=0.0),
                                       orientation=types.SimpleNamespace(w=0.0)),
            covariance=[0.0] * 36,
        ),
    )


class PoseSeedTests(unittest.TestCase):
    def setUp(self):
        self.clock = 0.0
        self.callback = None
        self.node = Mock()
        self.publisher = Mock()
        self.publisher.get_subscription_count.return_value = 1
        self.node.create_publisher.return_value = self.publisher
        self.node.create_subscription.side_effect = self.subscribe
        self.node.get_clock.return_value.now.return_value.nanoseconds = 1
        self.client = self.node.create_client.return_value
        self.client.service_is_ready.return_value = True
        self.future = self.client.call_async.return_value
        self.future.done.return_value = True
        self.future.result.return_value.current_state.id = 3
        self.buffer = Mock()
        self.odom_ready = True
        self.map_ready = False
        self.buffer.can_transform.side_effect = lambda target, *_args: self.map_ready if target == "map" else self.odom_ready
        self.ros = types.ModuleType("rclpy")
        self.ros.init = Mock()
        self.ros.create_node = Mock(return_value=self.node)
        self.ros.ok = Mock(return_value=True)
        self.ros.try_shutdown = Mock()
        self.ros.spin_once = Mock(side_effect=self.spin)
        qos = types.ModuleType("rclpy.qos")
        qos.QoSProfile = Mock()
        qos.DurabilityPolicy = types.SimpleNamespace(TRANSIENT_LOCAL="transient_local")
        qos.ReliabilityPolicy = types.SimpleNamespace(RELIABLE="reliable")
        parameter = types.ModuleType("rclpy.parameter")
        parameter.Parameter = Mock()
        signals = types.ModuleType("rclpy.signals")
        signals.SignalHandlerOptions = types.SimpleNamespace(NO=0)
        ros_time = types.ModuleType("rclpy.time")
        ros_time.Time = Mock()
        geometry = types.ModuleType("geometry_msgs.msg")
        geometry.PoseWithCovarianceStamped = pose_message
        lifecycle = types.ModuleType("lifecycle_msgs.srv")
        lifecycle.GetState = types.SimpleNamespace(Request=Mock())
        tf = types.ModuleType("tf2_ros")
        tf.Buffer = Mock(return_value=self.buffer)
        tf.TransformListener = Mock()
        self.qos = qos
        modules = patch.dict(sys.modules, {
            "rclpy": self.ros, "rclpy.qos": qos, "rclpy.parameter": parameter,
            "rclpy.signals": signals, "rclpy.time": ros_time,
            "geometry_msgs": types.ModuleType("geometry_msgs"), "geometry_msgs.msg": geometry,
            "lifecycle_msgs": types.ModuleType("lifecycle_msgs"), "lifecycle_msgs.srv": lifecycle,
            "tf2_ros": tf,
        })
        modules.start()
        self.addCleanup(modules.stop)
        clock = patch.object(MODULE.time, "monotonic", side_effect=lambda: self.clock)
        clock.start()
        self.addCleanup(clock.stop)

    def subscribe(self, _kind, _topic, callback, _qos):
        self.callback = callback

    def spin(self, _node, timeout_sec):
        self.clock += timeout_sec

    def test_lost_initial_publications_retry_until_amcl_acknowledges(self):
        def acknowledge_third(node, timeout_sec):
            self.spin(node, timeout_sec)
            if self.publisher.publish.call_count == 3:
                self.callback(pose_message())
        self.ros.spin_once.side_effect = acknowledge_third
        self.assertEqual(MODULE.seed_initial_pose("robot_1", -2.0, -0.5, 10), 0)
        self.assertEqual(self.publisher.publish.call_count, 3)
        self.assertGreaterEqual(self.clock, 4)
        self.node.create_publisher.assert_called_once()
        self.node.create_subscription.assert_called_once()
        self.qos.QoSProfile.assert_called_once_with(depth=1, reliability="reliable", durability="transient_local")
        message = self.publisher.publish.call_args.args[0]
        self.assertEqual(message.header.frame_id, "map")
        self.assertEqual((message.pose.pose.position.x, message.pose.pose.position.y), (-2.0, -0.5))
        self.assertEqual(len(message.pose.covariance), 36)
        self.assertEqual(message.pose.covariance[0], 0.25)
        self.assertEqual(message.pose.covariance[7], 0.25)
        self.assertGreater(message.pose.covariance[35], 0)
        self.node.destroy_node.assert_called_once()
        self.ros.try_shutdown.assert_called_once()

    def test_existing_localization_never_reseeds_a_robot(self):
        self.ros.spin_once.side_effect = lambda *_args, **_kwargs: self.callback(pose_message())
        self.assertEqual(MODULE.seed_initial_pose("robot_1", -2.0, -0.5, 5), 0)
        self.publisher.publish.assert_not_called()

    def test_map_tf_stops_reseeding_even_if_amcl_pose_callback_is_delayed(self):
        def localize_without_pose_callback(node, timeout_sec):
            self.spin(node, timeout_sec)
            self.map_ready = self.publisher.publish.call_count > 0
        self.ros.spin_once.side_effect = localize_without_pose_callback
        self.assertEqual(MODULE.seed_initial_pose("robot_1", 0.0, 0.0, 5), 0)
        self.publisher.publish.assert_called_once()

    def test_delayed_readiness_never_publishes_before_all_prerequisites(self):
        def delay_readiness(node, timeout_sec):
            self.spin(node, timeout_sec)
            self.future.result.return_value.current_state.id = 3 if self.clock >= 2 else 2
            self.publisher.get_subscription_count.return_value = int(self.clock >= 3)
            self.node.get_clock.return_value.now.return_value.nanoseconds = int(self.clock >= 4)
            self.odom_ready = self.clock >= 5
            if self.clock < 5:
                self.publisher.publish.assert_not_called()
            if self.publisher.publish.call_count:
                self.callback(pose_message())
        self.ros.spin_once.side_effect = delay_readiness
        self.assertEqual(MODULE.seed_initial_pose("robot_1", -2.0, -0.5, 8), 0)
        self.publisher.publish.assert_called_once()
        self.assertGreaterEqual(self.clock, 5)

    def test_no_acknowledgement_is_bounded_failure_even_after_publish(self):
        self.assertEqual(MODULE.seed_initial_pose("robot_1", 0.0, 0.0, 5), 1)
        self.assertGreater(self.publisher.publish.call_count, 1)
        self.assertLessEqual(self.clock, 5.1)

    def test_missing_each_readiness_requirement_fails_without_publishing(self):
        for requirement in ("active", "subscription", "clock", "odom", "service"):
            with self.subTest(requirement=requirement):
                self.clock = 0
                self.future.result.return_value.current_state.id = 2 if requirement == "active" else 3
                self.publisher.get_subscription_count.return_value = int(requirement != "subscription")
                self.node.get_clock.return_value.now.return_value.nanoseconds = int(requirement != "clock")
                self.odom_ready = requirement != "odom"
                self.client.service_is_ready.return_value = requirement != "service"
                self.assertEqual(MODULE.seed_initial_pose("robot_1", 0.0, 0.0, 2), 1)
                self.publisher.publish.assert_not_called()

    def test_lifecycle_response_never_arrives_is_bounded(self):
        self.future.done.return_value = False
        self.assertEqual(MODULE.seed_initial_pose("robot_1", 0.0, 0.0, 2), 1)
        self.publisher.publish.assert_not_called()
        self.client.call_async.assert_called_once()

    def test_signal_cancels_without_publishing_and_restores_handler(self):
        for sig in (signal.SIGINT, signal.SIGTERM):
            with self.subTest(signal=sig):
                previous = signal.getsignal(sig)
                self.ros.spin_once.side_effect = lambda *_args, **_kwargs: signal.getsignal(sig)(sig, None)
                self.assertEqual(MODULE.seed_initial_pose("robot_1", 0.0, 0.0, 30), 128 + sig)
                self.assertEqual(signal.getsignal(sig), previous)
                self.publisher.publish.assert_not_called()

    def test_exception_releases_node_and_context(self):
        self.node.create_subscription.side_effect = RuntimeError("DDS failure")
        with self.assertRaisesRegex(RuntimeError, "DDS failure"):
            MODULE.seed_initial_pose("robot_1", 0.0, 0.0, 5)
        self.node.destroy_node.assert_called_once()
        self.ros.try_shutdown.assert_called_once()

    def test_bad_arguments_fail_before_ros_imports(self):
        for args in [("robot;id", "0", "0", "5"), ("robot_1", "nan", "0", "5"),
                     ("robot_1", "0", "inf", "5"), ("robot_1", "0", "0", "0"),
                     ("robot_1", "0", "0", "301")]:
            result = subprocess.run([sys.executable, "-B", str(HELPER), *args], capture_output=True)
            self.assertEqual(result.returncode, 2)
            self.assertNotIn(b"No module named", result.stderr)

    def test_image_and_entrypoint_ship_acknowledged_initializer(self):
        recipe = (ROOT / "Containerfile").read_text()
        entrypoint = (ROOT / "entrypoint-nav2.sh").read_text()
        self.assertIn("COPY lib/seed-initial-pose.py /usr/local/lib/robotics/seed-initial-pose.py", recipe)
        self.assertIn('if wait "${INITIAL_POSE_PID}"', entrypoint)
        self.assertIn('kill "${NAV2_PID}"', entrypoint)
        self.assertNotIn("ros2 topic pub --once", entrypoint)


if __name__ == "__main__":
    unittest.main()
