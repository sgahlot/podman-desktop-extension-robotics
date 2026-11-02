#!/usr/bin/env python3
"""Resolve the bundled robot descriptor to validated env lines; never shell code."""

import json
import os
import pathlib
import re
import sys


def token(value, pattern, label):
    if not isinstance(value, str) or not re.fullmatch(pattern, value):
        raise ValueError(f"invalid {label}")
    return value


def relative(value):
    token(value, r"[a-zA-Z0-9_][a-zA-Z0-9_./-]*", "robot asset path")
    if value.startswith("/") or ".." in value:
        raise ValueError("invalid robot asset path")
    return value


def absolute(value):
    token(value, r"/[a-zA-Z0-9_./-]+", "robot asset directory")
    if ".." in value:
        raise ValueError("invalid robot asset directory")
    return value.rstrip("/")


def resolve(catalog, ros_prefix, sim_dir):
    robot_id = os.environ.get("PHYSICAL_AI_ROBOT_ID", catalog["defaultRobot"])
    robot = next((item for item in catalog["robots"] if item["id"] == robot_id), None)
    if robot is None:
        raise ValueError("unknown robot definition")
    token(robot_id, r"[a-z][a-z0-9_-]{0,63}", "robot id")
    package_pattern = r"[a-z][a-z0-9_]{0,127}"
    description = token(robot["descriptionPackage"], package_pattern, "description package")
    launch_package = token(robot["minimalSimPackage"], package_pattern, "launch package")
    launch = relative(robot["minimalSimLaunch"])
    if not launch.endswith((".launch.py", ".launch.xml", ".launch.yaml")):
        raise ValueError("invalid robot launch file")
    prefix = absolute(ros_prefix)
    share = f"{prefix}/share"
    sim_dir = absolute(sim_dir) if sim_dir else f"{share}/{description}"
    model_env = token(robot["modelEnvVar"], r"[A-Z][A-Z0-9_]*_MODEL", "model env name")
    model = token(os.environ.get(model_env) or robot["modelValue"], r"[a-zA-Z0-9_-]+", "robot model")
    nav_package = token(robot["navigationPackage"], package_pattern, "navigation package")
    nav_launch = relative(robot["navigationLaunch"])
    nav_map = os.environ.get("ROBOTICS_NAV2_MAP") or f'{share}/{nav_package}/{relative(robot["navigationMap"])}'
    nav_map = absolute(nav_map)
    # Preserve the existing map override's paired params directory behavior.
    nav_params = f'{pathlib.PurePosixPath(nav_map).parent.parent}/{relative(robot["nav2ParamsTemplate"])}'
    return {
        "PHYSICAL_AI_ROBOT_ID": robot_id,
        "PHYSICAL_AI_ROBOT_MODEL": model,
        model_env: model,
        "PHYSICAL_AI_ROBOT_URDF": f'{sim_dir}/{relative(robot["urdfPath"])}',
        "PHYSICAL_AI_ROBOT_BRIDGE_CONFIG": f'{sim_dir}/{relative(robot["bridgeConfig"])}',
        "PHYSICAL_AI_ROBOT_RESOURCE_DIR": f'{share}/{description}/{relative(robot["resourcePath"])}',
        "PHYSICAL_AI_MINIMAL_SIM_PKG": launch_package,
        "PHYSICAL_AI_MINIMAL_SIM_LAUNCH": launch,
        "PHYSICAL_AI_NAV2_PACKAGE": nav_package,
        "PHYSICAL_AI_NAV2_LAUNCH": nav_launch,
        "PHYSICAL_AI_NAV2_PARAMS": nav_params,
        "ROBOTICS_NAV2_MAP": nav_map,
    }


if __name__ == "__main__":
    try:
        with open(sys.argv[1], encoding="utf-8") as source:
            values = resolve(json.load(source), sys.argv[2], sys.argv[3])
        for name, value in values.items():
            print(f"{name}={value}")
    except (OSError, ValueError, KeyError, TypeError, IndexError) as error:
        print(f"error: invalid robot definition: {error}", file=sys.stderr)
        sys.exit(1)
