#!/usr/bin/env python3
"""Descriptor resolution/security tests; no ROS, Podman, or extra Python packages."""

import copy
import hashlib
import importlib.util
import json
import os
import pathlib
import subprocess
import sys
import tempfile
import unittest
import xml.etree.ElementTree as ET
from unittest.mock import patch

ROOT = pathlib.Path(__file__).resolve().parent.parent
SPEC = importlib.util.spec_from_file_location("robot_definition", ROOT / "lib/robot-definition.py")
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)
CATALOG = json.loads((ROOT / "config/robot-definitions.json").read_text())
PATCH_SPEC = importlib.util.spec_from_file_location("patch_nav2_params", ROOT / "lib/patch-nav2-params.py")
PATCH_MODULE = importlib.util.module_from_spec(PATCH_SPEC)
PATCH_SPEC.loader.exec_module(PATCH_MODULE)


class RobotDefinitionTests(unittest.TestCase):
    def setUp(self):
        self.env = patch.dict(os.environ, {}, clear=True)
        self.env.start()
        self.addCleanup(self.env.stop)

    def test_defaults_match_existing_managed_runtime(self):
        values = MODULE.resolve(CATALOG, "/opt/ros/humble", "")
        self.assertEqual(values["TURTLEBOT3_MODEL"], "waffle")
        self.assertEqual(values["PHYSICAL_AI_ROBOT_URDF"], "/opt/ros/humble/share/nav2_minimal_tb3_sim/urdf/turtlebot3_waffle.urdf")
        self.assertEqual(values["PHYSICAL_AI_ROBOT_BRIDGE_CONFIG"], "/opt/ros/humble/share/nav2_minimal_tb3_sim/configs/turtlebot3_waffle_bridge.yaml")
        self.assertEqual(values["PHYSICAL_AI_MINIMAL_SIM_PKG"], "nav2_minimal_tb3_sim")
        self.assertEqual(values["PHYSICAL_AI_MINIMAL_SIM_LAUNCH"], "spawn_tb3.launch.py")
        self.assertEqual(values["PHYSICAL_AI_NAV2_PARAMS"], "/opt/ros/humble/share/nav2_bringup/params/nav2_params.yaml")
        self.assertEqual(values["ROBOTICS_NAV2_MAP"], "/opt/ros/humble/share/nav2_minimal_tb3_sim/maps/tb3_sandbox.yaml")

    def test_source_overlay_and_underlay_resolve_independently(self):
        with tempfile.TemporaryDirectory() as directory:
            overlay = pathlib.Path(directory) / "overlay"
            underlay = pathlib.Path(directory) / "underlay"
            for prefix, package in [(overlay, "nav2_minimal_tb3_sim"), (underlay, "nav2_bringup")]:
                index = prefix / "share/ament_index/resource_index/packages"
                index.mkdir(parents=True)
                (index / package).touch()
            os.environ["AMENT_PREFIX_PATH"] = f"{overlay}:{underlay}"
            values = MODULE.resolve(CATALOG, str(overlay), "")
            self.assertEqual(values["PHYSICAL_AI_NAV2_PARAMS"], f"{underlay}/share/nav2_bringup/params/nav2_params.yaml")
            self.assertEqual(values["ROBOTICS_NAV2_MAP"], f"{overlay}/share/nav2_minimal_tb3_sim/maps/tb3_sandbox.yaml")
            self.assertEqual(values["PHYSICAL_AI_ROBOT_RESOURCE_DIR"], f"{overlay}/share/nav2_minimal_tb3_sim/models")
            (underlay / "share/ament_index/resource_index/packages/nav2_bringup").unlink()
            with self.assertRaisesRegex(ValueError, "nav2_bringup"):
                MODULE.resolve(CATALOG, str(overlay), "")

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
        self.assertEqual(values["ROBOTICS_NAV2_MAP"], "/opt/ros/jazzy/share/nav2_minimal_tb3_sim/maps/tb3_sandbox.yaml")

    def test_descriptor_not_script_literals_owns_all_robot_assets(self):
        catalog = copy.deepcopy(CATALOG)
        robot = catalog["robots"][0]
        robot.update(descriptionPackage="robot_description", minimalSimPackage="robot_sim",
                     minimalSimLaunch="spawn.launch.py", modelEnvVar="ROBOT_MODEL", modelValue="variant",
                     urdfPath="urdf/robot.urdf", bridgeConfig="config/bridge.yaml", resourcePath="resources",
                      navigationPackage="robot_nav", navigationMapPackage="robot_nav", navigationLaunch="navigate.launch.py",
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
                              ("modelEnvVar", "BASH_ENV"), ("resourcePath", "models\nPATH=bad"),
                              ("navigationMapPackage", "bad;id")]:
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


class OgreRecipeTests(unittest.TestCase):
    """Packaging guards only; runtime correctness requires the image probe."""

    def test_main_recipe_runs_verified_renderer_backport_on_both_arches(self):
        recipe = (ROOT / "Containerfile").read_text()
        builder = (ROOT / "lib/build-ogre-next.sh").read_text()
        patch_file = ROOT / "patches/ogre-next-material-lifetime.patch"
        digest = hashlib.sha256(patch_file.read_bytes()).hexdigest()
        self.assertIn("COPY patches/ogre-next-material-lifetime.patch", recipe)
        self.assertIn("RUN bash /usr/local/lib/robotics/build-ogre-next.sh", recipe)
        self.assertIn(f"{digest}  material-lifetime.patch", builder)
        self.assertIn("sha256sum -c", builder)
        self.assertIn("patch --fuzz=0", builder)
        self.assertIn("dpkg-architecture -qDEB_HOST_MULTIARCH", builder)
        self.assertNotIn("aarch64-linux-gnu", builder)
        self.assertNotIn("x86_64-linux-gnu", builder)

    def test_package_pair_and_plugin_guards_remain_enabled(self):
        builder = (ROOT / "lib/build-ogre-next.sh").read_text()
        self.assertIn("apt-get install -y --no-remove --no-install-recommends", builder)
        self.assertIn('"${WORK}"/libogre-next-2.3.0_*physicalai1_*.deb', builder)
        self.assertIn('"${WORK}"/libogre-next-2.3-dev_*physicalai1_*.deb', builder)
        self.assertIn('test -f "${LIBDIR}/gz-rendering-8/engine-plugins/libgz-rendering-ogre2.so"', builder)
        self.assertIn("grep -q 'not found'", builder)
        self.assertIn("installed-library.sha256", builder)
        self.assertIn("const MaterialPtr previousMaterial = mMaterial;", (ROOT / "patches/ogre-next-material-lifetime.patch").read_text())

    def test_rebuilt_package_bytes_survive_the_image_layer_boundary(self):
        recipe = (ROOT / "Containerfile").read_text()
        builder = (ROOT / "lib/build-ogre-next.sh").read_text()
        self.assertIn("dpkg-query -L libogre-next-2.3.0 libogre-next-2.3-dev", builder)
        self.assertIn('[[ -f "${file}" && ! -L "${file}" ]]', builder)
        self.assertIn('touch -- "${file}"', builder)
        self.assertIn("touch /var/lib/dpkg/info/libogre-next-2.3*.md5sums", builder)
        self.assertLess(builder.index('touch -- "${file}"'), builder.index('> "${PROVENANCE}/installed-library.sha256"'))
        self.assertIn('sha256sum -c "${PROVENANCE}/installed-library.sha256"', builder)
        # A separate RUN validates committed bytes, not only the build container.
        build_step = recipe.index("RUN bash /usr/local/lib/robotics/build-ogre-next.sh")
        check_step = recipe.index("RUN sha256sum -c /opt/physical-ai/sources/ogre-next/installed-library.sha256")
        self.assertGreater(check_step, build_step)
        self.assertEqual(recipe.count("sha256sum -c /opt/physical-ai/sources/ogre-next/installed-library.sha256"), 2)


class AmclRecipeTests(unittest.TestCase):
    def test_recipe_builds_only_pinned_amcl_on_both_architectures(self):
        recipe = (ROOT / "Containerfile").read_text()
        builder = (ROOT / "lib/build-amcl-overlay.sh").read_text()
        digest = hashlib.sha256((ROOT / "patches/amcl-initialization-order.patch").read_bytes()).hexdigest()
        self.assertIn(f"{digest}  initialization-order.patch", builder)
        self.assertIn("VERSION=1.1.20", builder)
        self.assertIn("c965b7a36ef48cd7f35f01c1f98883741693d195dae582232d6d0444d2eedab6", builder)
        self.assertIn("--packages-select nav2_amcl", builder)
        self.assertIn("-DCMAKE_BUILD_TYPE=Release", builder)
        self.assertIn("patch --batch --fuzz=0", builder)
        self.assertNotIn("aarch64", builder)
        self.assertNotIn("x86_64", builder)
        self.assertIn("ROBOTICS_ROS_SETUP=/opt/physical-ai/nav2-amcl/setup.bash", recipe)
        self.assertIn("COPY test/amcl-initialization/", recipe)
        build_step = recipe.index("RUN bash /usr/local/lib/robotics/build-amcl-overlay.sh")
        check_step = recipe.index("RUN sha256sum -c /opt/physical-ai/sources/nav2-amcl/installed-libraries.sha256")
        self.assertGreater(check_step, build_step)
        self.assertEqual(recipe.count("sha256sum -c /opt/physical-ai/sources/nav2-amcl/installed-libraries.sha256"), 2)
        regression = (ROOT / "test/amcl-initialization/main.cpp").read_text()
        self.assertIn("quiet_NaN()", regression)
        self.assertIn("std::isfinite(particles.samples[sample].pose.v[axis])", regression)
        self.assertIn("RMW_IMPLEMENTATION=rmw_fastrtps_cpp", builder)

    def test_patch_initializes_odometry_before_filter_and_rejects_drift(self):
        # Exact configure excerpt from the pinned Navigation2 1.1.20 source.
        before = """    rclcpp::CallbackGroupType::MutuallyExclusive, false);
  initParameters();
  initTransforms();
  initParticleFilter();
  initLaserScan();
  initMessageFilters();
  initPubSub();
  initServices();
  initOdometry();
  executor_ = std::make_shared<rclcpp::executors::SingleThreadedExecutor>();
  executor_->add_callback_group(callback_group_, get_node_base_interface());
  executor_thread_ = std::make_unique<nav2_util::NodeThread>(executor_);
"""
        patch_file = ROOT / "patches/amcl-initialization-order.patch"
        with tempfile.TemporaryDirectory() as directory:
            source = pathlib.Path(directory) / "src/amcl_node.cpp"
            source.parent.mkdir()
            source.write_text("// fixture\n" * 240 + before)
            args = ["patch", "--batch", "--fuzz=0", "-p1", "-d", directory, "-i", str(patch_file)]
            result = subprocess.run(args, capture_output=True, text=True)
            self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
            after = source.read_text()
            self.assertLess(after.index("initOdometry();"), after.index("initParticleFilter();"))
            self.assertEqual(after.count("initOdometry();"), 1)
            source.write_text(before.replace("initParameters();", "changedParameters();"))
            result = subprocess.run(args, capture_output=True, text=True)
            self.assertNotEqual(result.returncode, 0)


class Nav2ParameterPatchTests(unittest.TestCase):
    def test_costmap_sources_use_the_robot_scan_while_other_relative_topics_remain_relative(self):
        params = {
            "amcl": {"ros__parameters": {"scan_topic": "/scan"}},
            "local_costmap": {"ros__parameters": {
                "observation_sources": "scan depth",
                "scan": {"topic": "scan"},
                "depth": {"topic": "/depth/points"},
            }},
            "global_costmap": {"ros__parameters": {
                "observation_sources": "obstacles",
                "obstacles": {"topic": "/scan"},
            }},
        }
        patched = PATCH_MODULE.patch_topics(params, "robot_1")
        self.assertEqual(patched["amcl"]["ros__parameters"]["scan_topic"], "scan")
        self.assertEqual(patched["local_costmap"]["ros__parameters"]["scan"]["topic"], "/robot_1/scan")
        self.assertEqual(patched["local_costmap"]["ros__parameters"]["depth"]["topic"], "/depth/points")
        self.assertEqual(patched["global_costmap"]["ros__parameters"]["obstacles"]["topic"], "/robot_1/scan")


class FastDdsProfileTests(unittest.TestCase):
    def test_service_response_profile_is_packaged_without_changing_zenoh_selection(self):
        recipe = (ROOT / "Containerfile").read_text()
        profile = ROOT / "config/fastdds-service-response.xml"
        namespace = {"fastdds": "http://www.eprosima.com/XMLSchemas/fastRTPS_Profiles"}
        root = ET.parse(profile).getroot()
        publisher = root.find("fastdds:publisher", namespace)
        self.assertIsNotNone(publisher)
        self.assertEqual(publisher.attrib["profile_name"], "service")
        self.assertEqual(publisher.findtext("fastdds:qos/fastdds:reliability/fastdds:kind", namespaces=namespace), "RELIABLE")
        self.assertEqual(publisher.findtext("fastdds:qos/fastdds:reliability/fastdds:max_blocking_time/fastdds:sec", namespaces=namespace), "2")
        self.assertIn("COPY config/fastdds-service-response.xml", recipe)
        self.assertIn("FASTRTPS_DEFAULT_PROFILES_FILE=/opt/ros2-demo/config/fastdds-service-response.xml", recipe)
        self.assertNotIn("RMW_FASTRTPS_USE_QOS_FROM_XML", recipe)


class ClockBridgeTests(unittest.TestCase):
    def test_helper_executes_only_world_to_ros_clock_with_validated_arguments(self):
        with tempfile.TemporaryDirectory() as directory:
            base = pathlib.Path(directory)
            binary = base / "lib/ros_gz_bridge/parameter_bridge"
            binary.parent.mkdir(parents=True)
            binary.write_text(f"#!{sys.executable}\nimport json, sys\nprint(json.dumps(sys.argv[1:]))\n")
            binary.chmod(0o755)
            setup = base / "setup.bash"
            setup.write_text('ros2() { [[ "$*" == "pkg prefix ros_gz_bridge" ]] || return 1; printf "%s\\n" "$FAKE_PREFIX"; }\n')
            env = {"PATH": os.defpath, "ROBOTICS_ROS_SETUP": str(setup), "FAKE_PREFIX": directory}
            helper = ROOT / "lib/run-clock-bridge.sh"
            result = subprocess.run(["bash", str(helper), "tb3_sandbox"], env=env, capture_output=True, text=True)
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertEqual(json.loads(result.stdout), [
                "/world/tb3_sandbox/clock@rosgraph_msgs/msg/Clock[gz.msgs.Clock", "--ros-args",
                "-r", "__node:=physical_ai_clock_bridge", "-r", "/world/tb3_sandbox/clock:=/clock",
                "-p", "use_sim_time:=false",
            ])
            for world in ["bad;touch nope", "../world", "world/name", "$(id)", ""]:
                result = subprocess.run(["bash", str(helper), world], env=env, capture_output=True, text=True)
                self.assertNotEqual(result.returncode, 0, world)
                self.assertNotIn("--ros-args", result.stdout)

    def test_patch_removes_only_clock_and_rejects_upstream_drift(self):
        # Exact pinned upstream header; keep all robot-specific bridges intact.
        header = ('# replace clock_bridge\n- topic_name: "/clock"\n'
                  '  ros_type_name: "rosgraph_msgs/msg/Clock"\n  gz_type_name: "gz.msgs.Clock"\n'
                  '  direction: GZ_TO_ROS\n\n')
        sensors = ('# no equivalent in TB3 - add\n- topic_name: "joint_states"\n'
                   '  ros_type_name: "sensor_msgs/msg/JointState"\n')
        sensors += ''.join(f'- topic_name: "{topic}"\n' for topic in ["odom", "tf", "imu", "scan", "cmd_vel"])
        with tempfile.TemporaryDirectory() as directory:
            config = pathlib.Path(directory) / "bridge.yaml"
            config.write_text(header + sensors)
            args = ["patch", "--batch", "--fuzz=0", str(config), str(ROOT / "patches/simulation-owned-clock.patch")]
            result = subprocess.run(args, capture_output=True, text=True)
            self.assertEqual(result.returncode, 0, result.stderr + result.stdout)
            self.assertEqual(config.read_text(), sensors)
            config.write_text((header + sensors).replace('"/clock"', '"/changed_clock"'))
            result = subprocess.run(args, capture_output=True, text=True)
            self.assertNotEqual(result.returncode, 0)

    def test_packaged_patch_is_after_source_build_and_shared_with_fallback(self):
        recipe = (ROOT / "Containerfile").read_text()
        self.assertIn("COPY lib/run-clock-bridge.sh /usr/local/lib/robotics/run-clock-bridge.sh", recipe)
        self.assertGreater(recipe.index("RUN patch --fuzz=0"), recipe.index("RUN bash /usr/local/lib/robotics/build-ogre-next.sh"))
        self.assertIn("/opt/physical-ai/humble/share/nav2_minimal_tb3_sim/configs/turtlebot3_waffle_bridge.yaml", recipe)
        spawn = (ROOT / "entrypoint-spawn-robot.sh").read_text()
        self.assertIn("PHYSICAL_AI_ROBOT_BRIDGE_CONFIG", spawn)
        self.assertNotIn('topic_name: "/clock"', spawn)

    def test_startup_failure_and_signal_cleanup_reap_world_children(self):
        entrypoint = (ROOT / "entrypoint-gazebo.sh").read_text()
        lifecycle = entrypoint.split("# Simulation process cleanup", 1)[1].split("# Zenoh middleware", 1)[0]
        lifecycle = "# Simulation process cleanup" + lifecycle
        self.assertLess(entrypoint.index("trap term_handler EXIT"), entrypoint.index("GZ_SERVER_PID=$!"))
        self.assertIn('wait -n "${GZ_SERVER_PID}" "${CLOCK_BRIDGE_PID}"', entrypoint)
        # Execute the actual cleanup/startup functions without ROS/display tools.
        for mode in ["clock_failure", "server_failure", "clock_clean_exit", "signal"]:
            with self.subTest(mode=mode), tempfile.TemporaryDirectory() as directory:
                pids = pathlib.Path(directory) / "pids"
                server = '(sleep 0.1; exit 9)' if mode == "server_failure" else 'sleep 30'
                clock = '(sleep 0.1; exit 7)' if mode == "clock_failure" else '(sleep 0.1; exit 0)' if mode == "clock_clean_exit" else 'sleep 30'
                script = 'set -eu\n' + lifecycle + f'\n{server} &\nGZ_SERVER_PID=$!\n{clock} &\nCLOCK_BRIDGE_PID=$!\n'
                script += 'printf "%s\\n" "$GZ_SERVER_PID" "$CLOCK_BRIDGE_PID" > "$1"\nsleep 0.3\n'
                script += 'kill -TERM $$\n' if mode == "signal" else 'check_simulation_processes\n'
                result = subprocess.run(["bash", "-c", script, "_", str(pids)], capture_output=True, text=True, timeout=5)
                self.assertEqual(result.returncode, {"clock_failure": 7, "server_failure": 9, "clock_clean_exit": 1, "signal": 143}[mode], result.stderr)
                for pid in pids.read_text().splitlines():
                    with self.assertRaises(ProcessLookupError):
                        os.kill(int(pid), 0)

    @unittest.skipUnless(sys.platform == "linux", "runtime wait -n requires the image's Linux Bash")
    def test_runtime_wait_supervises_server_and_clock_and_cleans_up(self):
        entrypoint = (ROOT / "entrypoint-gazebo.sh").read_text()
        lifecycle = "# Simulation process cleanup" + entrypoint.split("# Simulation process cleanup", 1)[1].split("# Zenoh middleware", 1)[0]
        supervise = "# A dead clock bridge" + entrypoint.split("# A dead clock bridge", 1)[1]
        for server_status, clock_status, expected in [(None, 7, 7), (None, 0, 1), (9, None, 9)]:
            with self.subTest(server=server_status, clock=clock_status), tempfile.TemporaryDirectory() as directory:
                pids = pathlib.Path(directory) / "pids"
                def child(status):
                    return 'sleep 30' if status is None else f'(sleep 0.3; exit {status})'
                script = 'set -eu\n' + lifecycle + f'\n{child(server_status)} &\nGZ_SERVER_PID=$!\n{child(clock_status)} &\nCLOCK_BRIDGE_PID=$!\n'
                script += 'printf "%s\\n" "$GZ_SERVER_PID" "$CLOCK_BRIDGE_PID" > "$1"\n' + supervise
                result = subprocess.run(["bash", "-c", script, "_", str(pids)], capture_output=True, text=True, timeout=5)
                self.assertEqual(result.returncode, expected, result.stderr)
                for pid in pids.read_text().splitlines():
                    with self.assertRaises(ProcessLookupError):
                        os.kill(int(pid), 0)


class RuntimeHarnessTests(unittest.TestCase):
    """Check host-side command construction without starting Podman/ROS."""

    def run_harness(self, uid="", arch="arm64", fail_probe=False, fail_integrity=False):
        with tempfile.TemporaryDirectory() as directory:
            bin_dir = pathlib.Path(directory) / "bin"
            bin_dir.mkdir()
            log = pathlib.Path(directory) / "calls.jsonl"
            stub = bin_dir / "podman"
            stub.write_text(f"#!{sys.executable}\n" + '''import json, os, sys
with open(os.environ["STUB_LOG"], "a") as output:
    output.write(json.dumps(sys.argv[1:]) + "\\n")
if sys.argv[1:3] == ["image", "inspect"]:
    print("arm64")
elif sys.argv[1] == "run":
    print("test-owned-container")
elif sys.argv[1] == "exec" and os.environ.get("STUB_FAIL_INTEGRITY") == "1" and "sha256sum" in sys.argv:
    sys.exit(1)
elif sys.argv[1] == "exec" and os.environ.get("STUB_FAIL_PROBE") == "1" and any("python3 /tmp/runtime-smoke.py" in arg for arg in sys.argv):
    sys.exit(7)
''')
            stub.chmod(0o755)
            env = {"PATH": f"{bin_dir}:{os.defpath}", "STUB_LOG": str(log), "HUMBLE_SMOKE_UID": uid}
            env["STUB_FAIL_PROBE"] = "1" if fail_probe else "0"
            env["STUB_FAIL_INTEGRITY"] = "1" if fail_integrity else "0"
            env["HUMBLE_SMOKE_LOG_DIR"] = f"{directory}/logs"
            script = ROOT.parents[3] / "scripts/integration/humble-sim.sh"
            result = subprocess.run(["/bin/bash", str(script), "localhost/test:sim", arch],
                                    env=env, capture_output=True, text=True)
            calls = [json.loads(line) for line in log.read_text().splitlines()]
            return result, calls

    def test_empty_user_args_under_host_bash_nounset(self):
        result, calls = self.run_harness()
        self.assertEqual(result.returncode, 0, result.stderr)
        run = next(call for call in calls if call[0] == "run")
        self.assertNotIn("--user", run)
        self.assertIn("ROS_LOCALHOST_ONLY=1", run)
        self.assertTrue(any(arg.startswith("GZ_PARTITION=appeng-6071-smoke-") for arg in run))
        self.assertIn(["rm", "-f", "test-owned-container"], calls)

    def test_arbitrary_uid_is_passed_as_one_argument(self):
        result, calls = self.run_harness(uid="10001:0")
        self.assertEqual(result.returncode, 0, result.stderr)
        run = next(call for call in calls if call[0] == "run")
        self.assertEqual(run[run.index("--user") + 1], "10001:0")

    def test_library_integrity_is_checked_before_runtime_probes(self):
        result, calls = self.run_harness()
        self.assertEqual(result.returncode, 0, result.stderr)
        integrity = ["exec", "test-owned-container", "sha256sum", "-c",
                     "/opt/physical-ai/sources/ogre-next/installed-library.sha256"]
        self.assertIn(integrity, calls)
        self.assertLess(calls.index(integrity), next(i for i, call in enumerate(calls) if call[0] == "cp"))

    def test_library_integrity_failure_prevents_spawn_and_preserves_failure(self):
        result, calls = self.run_harness(fail_integrity=True)
        self.assertEqual(result.returncode, 1, result.stderr)
        self.assertFalse(any("/entrypoint-spawn-robot.sh" in call for call in calls))
        self.assertIn(["rm", "-f", "test-owned-container"], calls)
        self.assertNotIn("PASS: Humble", result.stdout)

    def test_wrong_architecture_never_starts_container(self):
        result, calls = self.run_harness(arch="amd64")
        self.assertNotEqual(result.returncode, 0)
        self.assertFalse(any(call[0] == "run" for call in calls))

    def test_probe_failure_is_preserved_after_cleanup(self):
        result, calls = self.run_harness(fail_probe=True)
        self.assertEqual(result.returncode, 7, result.stderr)
        self.assertIn(["rm", "-f", "test-owned-container"], calls)
        self.assertNotIn("PASS: Humble", result.stdout)

    def test_concurrent_robot_navigation_and_clock_survive_robot_removal(self):
        result, calls = self.run_harness()
        self.assertEqual(result.returncode, 0, result.stderr)
        probes = [call for call in calls if any("python3 /tmp/runtime-smoke.py" in arg for arg in call)]
        self.assertTrue(any(call[-4:] == ["navigation", "robot_peer", "1.0", "0.5"] for call in probes))
        self.assertTrue(any(call[-4:] == ["navigation", "robot_test", "-2.0", "-0.5"] for call in probes))
        removal = next(i for i, call in enumerate(calls) if any("gz service -s /world/tb3_sandbox/remove" in arg for arg in call))
        respawn = next(i for i, call in enumerate(calls) if i > removal and "/entrypoint-spawn-robot.sh" in call)
        self.assertTrue(any(call[-1:] == ["clock"] for call in calls[removal:respawn]))
        self.assertTrue(any(call[-2:] == ["sensors", "robot_peer"] for call in calls[removal:respawn]))


if __name__ == "__main__":
    unittest.main()
