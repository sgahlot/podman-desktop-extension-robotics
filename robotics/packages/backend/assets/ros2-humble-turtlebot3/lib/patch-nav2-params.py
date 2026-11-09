#!/usr/bin/env python3
"""Patch upstream nav2_params.yaml for namespaced single-robot sim use."""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

TOPIC_KEYS = frozenset(
    {
        "topic",
        "odom_topic",
        "scan_topic",
        "map_topic",
        "cmd_vel_in_topic",
        "cmd_vel_out_topic",
    }
)

TOPIC_REWRITES = {
    "/scan": "scan",
    "/odom": "odom",
    "/map": "map",
    "/cmd_vel": "cmd_vel",
    "/cmd_vel_smoothed": "cmd_vel_smoothed",
}


def patch_topics(value: object, robot_name: str) -> object:
    if isinstance(value, dict):
        patched: dict[object, object] = {}
        for key, item in value.items():
            if key in TOPIC_KEYS and isinstance(item, str):
                patched[key] = TOPIC_REWRITES.get(item, item)
            else:
                patched[key] = patch_topics(item, robot_name)
        # Costmap observation sources run inside local_costmap/global_costmap
        # namespaces. A relative `scan` therefore resolves to a silent nested
        # topic instead of the bridge's /<robot>/scan. Qualify only explicitly
        # declared observation-source topics; AMCL's relative scan stays scoped
        # by the robot namespace as intended.
        sources = patched.get("observation_sources")
        if isinstance(sources, str):
            for source in sources.split():
                source_config = patched.get(source)
                if isinstance(source_config, dict) and source_config.get("topic") in {"scan", "/scan"}:
                    source_config["topic"] = f"/{robot_name}/scan"
        return patched
    if isinstance(value, list):
        return [patch_topics(item, robot_name) for item in value]
    return value


def main() -> int:
    import yaml

    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--source",
        default="/opt/ros/humble/share/nav2_bringup/params/nav2_params.yaml",
        help="Upstream Nav2 params file",
    )
    parser.add_argument("--output", required=True, help="Patched params output path")
    parser.add_argument("--robot-name", required=True, help="Validated Nav2 robot namespace")
    args = parser.parse_args()

    source = Path(args.source)
    output = Path(args.output)
    params = yaml.safe_load(source.read_text())
    patched = patch_topics(params, args.robot_name)
    output.write_text(yaml.dump(patched))
    return 0


if __name__ == "__main__":
    sys.exit(main())
