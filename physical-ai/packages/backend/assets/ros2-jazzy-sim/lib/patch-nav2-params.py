#!/usr/bin/env python3
"""Patch upstream nav2_params.yaml for namespaced single-robot sim use."""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

import yaml

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


def patch_topics(value: object) -> object:
    if isinstance(value, dict):
        patched: dict[object, object] = {}
        for key, item in value.items():
            if key in TOPIC_KEYS and isinstance(item, str):
                patched[key] = TOPIC_REWRITES.get(item, item)
            else:
                patched[key] = patch_topics(item)
        return patched
    if isinstance(value, list):
        return [patch_topics(item) for item in value]
    return value


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--source",
        default="/opt/ros/jazzy/share/nav2_bringup/params/nav2_params.yaml",
        help="Upstream Nav2 params file",
    )
    parser.add_argument("--output", required=True, help="Patched params output path")
    args = parser.parse_args()

    source = Path(args.source)
    output = Path(args.output)
    params = yaml.safe_load(source.read_text())
    patched = patch_topics(params)
    output.write_text(yaml.dump(patched))
    return 0


if __name__ == "__main__":
    sys.exit(main())
