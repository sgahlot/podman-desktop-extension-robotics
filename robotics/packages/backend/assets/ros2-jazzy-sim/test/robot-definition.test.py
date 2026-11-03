#!/usr/bin/env python3
"""Descriptor resolution/security tests; no ROS, Podman, or extra Python packages."""

import copy
import importlib.util
import json
import os
import pathlib
import subprocess
import tempfile
import unittest
from unittest.mock import patch

ROOT = pathlib.Path(__file__).resolve().parent.parent
SPEC = importlib.util.spec_from_file_location("robot_definition", ROOT / "lib/robot-definition.py")
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)
CATALOG = json.loads((ROOT / "config/robot-definitions.json").read_text())


class RobotDefinitionTests(unittest.TestCase):
    def setUp(self):
        self.env = patch.dict(os.environ, {}, clear=True)
        self.env.start()
        self.addCleanup(self.env.stop)

    def test_defaults_match_existing_managed_runtime(self):
        values = MODULE.resolve(CATALOG, "/opt/ros/jazzy", "")
        self.assertEqual(values["TURTLEBOT3_MODEL"], "waffle")
        self.assertEqual(values["PHYSICAL_AI_ROBOT_URDF"], "/opt/ros/jazzy/share/nav2_minimal_tb3_sim/urdf/turtlebot3_waffle.urdf")
        self.assertEqual(values["PHYSICAL_AI_ROBOT_BRIDGE_CONFIG"], "/opt/ros/jazzy/share/nav2_minimal_tb3_sim/configs/turtlebot3_waffle_bridge.yaml")
        self.assertEqual(values["PHYSICAL_AI_MINIMAL_SIM_PKG"], "nav2_minimal_tb3_sim")
        self.assertEqual(values["PHYSICAL_AI_MINIMAL_SIM_LAUNCH"], "spawn_tb3.launch.py")
        self.assertEqual(values["PHYSICAL_AI_NAV2_PARAMS"], "/opt/ros/jazzy/share/nav2_bringup/params/nav2_params.yaml")

    def test_distro_and_existing_overrides(self):
        os.environ["TURTLEBOT3_MODEL"] = "burger"
        os.environ["ROBOTICS_NAV2_MAP"] = "/maps/custom/maps/map.yaml"
        values = MODULE.resolve(CATALOG, "/opt/ros/lyrical", "/custom/sim")
        self.assertEqual(values["TURTLEBOT3_MODEL"], "burger")
        self.assertEqual(values["PHYSICAL_AI_ROBOT_URDF"], "/custom/sim/urdf/turtlebot3_waffle.urdf")
        self.assertEqual(values["PHYSICAL_AI_ROBOT_RESOURCE_DIR"], "/opt/ros/lyrical/share/nav2_minimal_tb3_sim/models")
        self.assertEqual(values["PHYSICAL_AI_NAV2_PARAMS"], "/maps/custom/params/nav2_params.yaml")

    def test_empty_legacy_overrides_keep_default_semantics(self):
        os.environ["TURTLEBOT3_MODEL"] = ""
        os.environ["ROBOTICS_NAV2_MAP"] = ""
        values = MODULE.resolve(CATALOG, "/opt/ros/jazzy", "")
        self.assertEqual(values["TURTLEBOT3_MODEL"], "waffle")
        self.assertEqual(values["ROBOTICS_NAV2_MAP"], "/opt/ros/jazzy/share/nav2_bringup/maps/tb3_sandbox.yaml")

    def test_descriptor_not_script_literals_owns_all_robot_assets(self):
        catalog = copy.deepcopy(CATALOG)
        robot = catalog["robots"][0]
        robot.update(descriptionPackage="robot_description", minimalSimPackage="robot_sim",
                     minimalSimLaunch="spawn.launch.py", modelEnvVar="ROBOT_MODEL", modelValue="variant",
                     urdfPath="urdf/robot.urdf", bridgeConfig="config/bridge.yaml", resourcePath="resources",
                     navigationPackage="robot_nav", navigationLaunch="navigate.launch.py",
                     nav2ParamsTemplate="params/robot.yaml", navigationMap="maps/robot.yaml")
        values = MODULE.resolve(catalog, "/opt/ros/jazzy", "")
        self.assertEqual(values["ROBOT_MODEL"], "variant")
        self.assertEqual(values["PHYSICAL_AI_MINIMAL_SIM_PKG"], "robot_sim")
        self.assertEqual(values["PHYSICAL_AI_ROBOT_URDF"], "/opt/ros/jazzy/share/robot_description/urdf/robot.urdf")
        self.assertEqual(values["PHYSICAL_AI_ROBOT_BRIDGE_CONFIG"], "/opt/ros/jazzy/share/robot_description/config/bridge.yaml")
        self.assertEqual(values["PHYSICAL_AI_ROBOT_RESOURCE_DIR"], "/opt/ros/jazzy/share/robot_description/resources")
        self.assertEqual(values["PHYSICAL_AI_NAV2_LAUNCH"], "navigate.launch.py")
        self.assertEqual(values["PHYSICAL_AI_NAV2_PARAMS"], "/opt/ros/jazzy/share/robot_nav/params/robot.yaml")

    def test_unknown_id_and_injected_environment_fail_closed(self):
        for key, value in [("PHYSICAL_AI_ROBOT_ID", "unknown"), ("TURTLEBOT3_MODEL", "waffle;id"),
                           ("ROBOTICS_NAV2_MAP", "/tmp/../etc/passwd")]:
            with self.subTest(key=key), patch.dict(os.environ, {key: value}):
                with self.assertRaises(ValueError):
                    MODULE.resolve(CATALOG, "/opt/ros/jazzy", "")
        for directory in ["../sim", "/tmp/../etc", "/tmp/sim;id", "/tmp/$(id)"]:
            with self.subTest(directory=directory), self.assertRaises(ValueError):
                MODULE.resolve(CATALOG, "/opt/ros/jazzy", directory)

    def test_invalid_descriptor_fields_fail_closed(self):
        for field, value in [("urdfPath", "../robot.urdf"), ("bridgeConfig", "/etc/passwd"),
                             ("minimalSimPackage", "robot;id"), ("minimalSimLaunch", "../spawn.launch.py"),
                             ("modelEnvVar", "BASH_ENV"), ("resourcePath", "models\nPATH=bad")]:
            catalog = copy.deepcopy(CATALOG)
            catalog["robots"][0][field] = value
            with self.subTest(field=field), self.assertRaises(ValueError):
                MODULE.resolve(catalog, "/opt/ros/jazzy", "")

    def test_fresh_exec_shell_resolves_and_exports_descriptor_without_pid1_env(self):
        # This is also how Podman/oc exec finds image-owned defaults: no exports
        # from the Gazebo/PID 1 shell are required.
        with tempfile.TemporaryDirectory() as directory:
            env = {"PATH": os.defpath, "ROBOTICS_ROS_SETUP": f"{directory}/setup.bash"}
            script = 'set -eu; source "$1"; pai_load_robot_definition; pai_export_gz_sim_resource_path; env'
            for _ in range(2):
                result = subprocess.run(["/bin/bash", "-c", script, "_", str(ROOT / "lib/validate-input.sh")],
                                        env=env, capture_output=True, text=True, check=True)
                values = dict(line.split("=", 1) for line in result.stdout.splitlines() if "=" in line)
                self.assertEqual(values["PHYSICAL_AI_ROBOT_ID"], "turtlebot3")
                self.assertEqual(values["TURTLEBOT3_MODEL"], "waffle")
                self.assertEqual(values["PHYSICAL_AI_ROBOT_URDF"], f"{directory}/share/nav2_minimal_tb3_sim/urdf/turtlebot3_waffle.urdf")
                self.assertEqual(values["GZ_SIM_RESOURCE_PATH"], f"{directory}/share:{directory}/share/nav2_minimal_tb3_sim/models:")


if __name__ == "__main__":
    unittest.main()
