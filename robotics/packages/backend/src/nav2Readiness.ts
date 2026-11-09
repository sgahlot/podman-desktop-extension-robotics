/** Executed in the simulation's ROS environment; supplied by the extension so
 * existing managed Humble images do not need rebuilding for readiness fixes. */
export const HUMBLE_NAV2_READINESS_PYTHON = String.raw`
import sys
import time
import uuid

import rclpy
from lifecycle_msgs.srv import GetState
from rclpy.node import Node
from rclpy.time import Time
from tf2_ros import Buffer, TransformListener


def main():
    robot, seconds = sys.argv[1:3]
    deadline = time.monotonic() + float(seconds)
    rclpy.init(args=[])
    node = None
    listener = None
    try:
        node = Node(
            'physical_ai_nav2_readiness_' + uuid.uuid4().hex[:12],
            cli_args=['--ros-args', '-p', 'use_sim_time:=true',
                      '-r', '/tf:=/' + robot + '/tf',
                      '-r', '/tf_static:=/' + robot + '/tf_static'],
            enable_rosout=False, start_parameter_services=False)
        buffer = Buffer(node=node)
        listener = TransformListener(buffer, node)
        client = node.create_client(GetState, '/' + robot + '/bt_navigator/get_state')
        pending = None
        sent_at = 0.0
        next_request = 0.0
        while rclpy.ok() and time.monotonic() < deadline:
            rclpy.spin_once(node, timeout_sec=min(0.1, max(0.0, deadline - time.monotonic())))
            now = time.monotonic()
            if now >= deadline:
                break
            if pending is not None:
                if pending.done():
                    try:
                        response = pending.result()
                    except Exception:
                        response = None
                    pending = None
                    # Evaluate TF at the time of a fresh lifecycle response, not
                    # against a cached earlier success. Buffer handles sim-time jumps.
                    if (response is not None and response.current_state.id == 3
                            and response.current_state.label == 'active'
                            and buffer.can_transform('map', 'base_link', Time())):
                        print('PHYSICAL_AI_NAV2_READY', flush=True)
                        return 0
                elif now - sent_at >= 2.0:
                    client.remove_pending_request(pending)
                    pending.cancel()
                    pending = None
            if pending is None and now >= next_request and client.service_is_ready():
                pending = client.call_async(GetState.Request())
                sent_at = now
                next_request = now + 1.0
        print('Nav2 readiness timed out: map->base_link TF or active bt_navigator missing', file=sys.stderr)
        return 1
    finally:
        if listener is not None:
            listener.unregister()
        if node is not None:
            node.destroy_node()
        rclpy.shutdown()


sys.exit(main())
`;
