#!/usr/bin/env bash
# Build only AMCL; keep the apt Nav2 stack and managed Harmonic overlay intact.
set -eo pipefail

VERSION=1.1.20
WORK=/tmp/humble-amcl-build
PREFIX=/opt/physical-ai/nav2-amcl
PROVENANCE=/opt/physical-ai/sources/nav2-amcl
mkdir -p "${WORK}/src" "${PROVENANCE}"
cd "${PROVENANCE}"
printf '%s\n' '2a1a7bdcc94ee1889f079a1ec7e5257259c0213aac5133ccd9572da0eeb8c682  initialization-order.patch' | sha256sum -c -
wget -q "https://codeload.github.com/ros-navigation/navigation2/tar.gz/refs/tags/${VERSION}" \
  -O navigation2.tar.gz
printf '%s\n' 'c965b7a36ef48cd7f35f01c1f98883741693d195dae582232d6d0444d2eedab6  navigation2.tar.gz' | sha256sum -c -
tar -xzf navigation2.tar.gz -C "${WORK}/src" --strip-components=1 "navigation2-${VERSION}/nav2_amcl"
patch --batch --fuzz=0 -p1 -d "${WORK}/src/nav2_amcl" < initialization-order.patch
printf 'navigation2 %s\npatch initialization-order.patch\n' "${VERSION}" > revisions.txt
dpkg-query -W ros-humble-nav2-amcl > underlay-package.txt

source /opt/physical-ai/humble/setup.bash
export MAKEFLAGS=-j1 CMAKE_BUILD_PARALLEL_LEVEL=1
cd "${WORK}"
colcon build --merge-install --install-base "${PREFIX}" --executor sequential \
  --packages-select nav2_amcl \
  --cmake-args -DBUILD_TESTING=OFF -DCMAKE_BUILD_TYPE=Release
source "${PREFIX}/setup.bash"
test "$(ros2 pkg prefix nav2_amcl)" = "${PREFIX}"

# Force invalid pre-configure values as in the captured failure, then require
# finite default covariance and finite particles. No simulator or Zenoh router.
cmake -S "${PROVENANCE}/regression" -B "${WORK}/regression" -DCMAKE_BUILD_TYPE=Release
cmake --build "${WORK}/regression" -j1
ROS_DOMAIN_ID=74 RMW_IMPLEMENTATION=rmw_fastrtps_cpp \
  timeout -k 2 30 "${WORK}/regression/amcl_initialization_regression"

# Refresh mtimes and validate again in a separate image layer, as for OGRE.
find "${PREFIX}" -type f -exec touch -- {} +
sha256sum "${PREFIX}/lib/libamcl_core.so" "${PREFIX}/lib/libpf_lib.so" \
  "${PREFIX}/lib/nav2_amcl/amcl" > "${PROVENANCE}/installed-libraries.sha256"
sha256sum -c "${PROVENANCE}/installed-libraries.sha256"
cd /
rm -rf "${WORK}"
