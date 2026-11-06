#!/usr/bin/env bash
# Build-only recipe: pinned upstream sources, shared by amd64 and arm64.
# Keep source archives/licenses in the image for provenance; discard build trees.
set -eo pipefail

ROS_GZ_REV=856e319ee4da713609b3f6e58c74ac8db7662482
TB3_REV=b9d523ad7ea0e98174627fdefeb4b1ae9b515063
NAV2_REV=40f9aa00bd12078f3b021019906146ba56357039
WORK=/tmp/humble-harmonic-build
PREFIX=/opt/physical-ai/humble
PROVENANCE=/opt/physical-ai/sources
mkdir -p "${WORK}/src" "${PROVENANCE}"

fetch_verified() {
  local url="$1" output="$2" checksum="$3"
  wget -q "${url}" -O "${output}"
  printf '%s  %s\n' "${checksum}" "${output}" | sha256sum -c -
}

fetch_verified "https://github.com/gazebosim/ros_gz/archive/${ROS_GZ_REV}.tar.gz" \
  "${PROVENANCE}/ros_gz.tar.gz" d9553948548d052c05722241f0934ea9216cbf40ae25a513981845d1f0d04b33
fetch_verified "https://github.com/ros-navigation/nav2_minimal_turtlebot_simulation/archive/${TB3_REV}.tar.gz" \
  "${PROVENANCE}/minimal_tb3.tar.gz" eb99a01698e16f251d6bdbc90de6f4c987901ec0b69861b187ca2c46a992c9d1
tar -xzf "${PROVENANCE}/ros_gz.tar.gz" -C "${WORK}/src"
tar -xzf "${PROVENANCE}/minimal_tb3.tar.gz" -C "${WORK}/src"

# The backported simulator world uses the sandbox map, which Humble Nav2 does
# not ship. Install that exact upstream asset with the simulation package;
# continue using Humble's own Nav2 plugins and parameter schema.
MAPS="${WORK}/src/nav2_minimal_turtlebot_simulation-${TB3_REV}/nav2_minimal_tb3_sim/maps"
mkdir -p "${MAPS}"
fetch_verified "https://raw.githubusercontent.com/ros-navigation/navigation2/${NAV2_REV}/nav2_bringup/maps/tb3_sandbox.yaml" \
  "${MAPS}/tb3_sandbox.yaml" 2a284eba0a3aa4a904bce71734c56a543e979899f1cf34daad6e8215e608b438
fetch_verified "https://raw.githubusercontent.com/ros-navigation/navigation2/${NAV2_REV}/nav2_bringup/maps/tb3_sandbox.pgm" \
  "${MAPS}/tb3_sandbox.pgm" 0103b9dfaa3b79592af71cc35d64f69cfbd3565d173160820ad8ef56cd27b3fc
wget -q "https://raw.githubusercontent.com/ros-navigation/navigation2/${NAV2_REV}/LICENSE" \
  -O "${PROVENANCE}/navigation2-LICENSE"
printf 'ros_gz %s\nminimal_tb3 %s\nnavigation2-map %s\n' \
  "${ROS_GZ_REV}" "${TB3_REV}" "${NAV2_REV}" > "${PROVENANCE}/humble-harmonic-revisions.txt"

source /opt/ros/humble/setup.bash
export GZ_VERSION=harmonic MAKEFLAGS=-j1 CMAKE_BUILD_PARALLEL_LEVEL=1
cd "${WORK}"
colcon build --merge-install --install-base "${PREFIX}" --executor sequential \
  --packages-select ros_gz_interfaces ros_gz_bridge ros_gz_image ros_gz_sim nav2_minimal_tb3_sim \
  --cmake-args -DBUILD_TESTING=OFF -DCMAKE_BUILD_TYPE=Release
cp -r "${MAPS}" "${PREFIX}/share/nav2_minimal_tb3_sim/maps"
source "${PREFIX}/setup.bash"
ros2 pkg prefix ros_gz_bridge
ros2 pkg prefix nav2_minimal_tb3_sim
ros2 launch nav2_minimal_tb3_sim spawn_tb3.launch.py --show-args
gz sim --versions
cd /
rm -rf "${WORK}"
