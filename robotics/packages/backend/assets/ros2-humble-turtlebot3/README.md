# ROS 2 Humble TurtleBot3 Simulation Image

Managed ROS 2 Humble TurtleBot3 simulation for Ubuntu Jammy, using Gazebo
Harmonic on both arm64 and amd64. **Validation in progress:** neither a
successful build nor the bundled entrypoints establish end-to-end parity.

Humble has no `nav2-minimal-tb3-sim` binary release. The image builds a
checksum-verified source overlay at `/opt/physical-ai/humble` from pinned
upstream Humble `ros_gz` and minimal TB3 sources. Both architectures use the
same source revisions, not a mix of Fortress and Harmonic bridges. Source
archives, licenses, and revision information remain under
`/opt/physical-ai/sources`; the build recipe is `lib/build-harmonic-overlay.sh`.

The sandbox map is pinned with the simulator assets; navigation parameters
and plugins come from Humble Nav2. Package discovery follows the sourced ament
index so map/model assets in the overlay and Nav2 in the ROS underlay can coexist.
Backend execs and image entrypoints honor `ROBOTICS_ROS_SETUP`.

Humble's `lib/seed-initial-pose.py` keeps one ROS publisher/subscriber alive
through startup. It waits for active AMCL, a matching initial-pose subscription,
simulation time and odometry TF, then retries every two seconds until an AMCL
pose or map-to-base TF acknowledges localization. Existing localization stops seeding without
resetting the robot. The entire operation is bounded by
`ROBOTICS_AMCL_READY_ATTEMPTS` (seconds, default 60); failure stops bringup and
is logged. This is separate from the shared continuous scan subscriber used
before Nav2 starts and the backend's final TF/active-navigator readiness gate.
Rebuild/redeploy images to acquire it; a reload cannot update running pods.

The recipe also rebuilds OSRF OGRE-Next 2.3.1 with the upstream
[material-lifetime fix](https://github.com/OGRECave/ogre-next/commit/fce90a5c8c2ae33815c7d6acf841344726364c50).
Without it, removing and recreating the depth camera can abort Gazebo. This
backport retains cameras and the OGRE2 renderer; it does not change the library
ABI. The source archives, patch, installed library checksum, package version,
and renderer linkage are retained under `/opt/physical-ai/sources/ogre-next`.
The build installs matching OGRE runtime/development packages and refuses
dependency removals so the Gazebo renderer cannot silently disappear.

Rebuilt package files and checksum metadata receive fresh timestamps before
the image layer is committed. This avoids a reproduced image-builder diff
failure that discarded replacement bytes with unchanged size/timestamps while
retaining the new package version. The recipe verifies the installed-library
checksum in a separate build step and again at final assembly; a successful
package installation alone is not enough. Earlier amd64 images can report the
patched package version yet still contain the original library: rebuild with
the current recipe, push, and redeploy. To verify a finished image or pod, run:

```bash
sha256sum -c /opt/physical-ai/sources/ogre-next/installed-library.sha256
```

## Build

Build the Humble base image first, then use it for the simulation layer:

```bash
podman build \
  --build-arg LOCAL_BASE_IMAGE=quay.io/ecosystem-appeng/ros2-humble-base:sloretz \
   -t quay.io/ecosystem-appeng/ros2-humble-sim:sloretz \
  packages/backend/assets/ros2-humble-turtlebot3/
```

## Runtime

```bash
podman run -d --name pai-humble-sim -p 6080:6080 -p 8080:8080 \
   quay.io/ecosystem-appeng/ros2-humble-sim:sloretz \
  /entrypoint-gazebo.sh

# Browser: http://localhost:6080
podman exec -d pai-humble-sim /entrypoint-spawn-robot.sh robot_1 -2.0 -0.5 0.0
```

The entrypoint picks one rendering path:

1. `ROBOTICS_USE_GPU=1` with `/dev/dri/renderD128`: hardware GLX.
2. `ROBOTICS_USE_GPU=1` without DRI (typical NVIDIA Operator pod): software
   EGL for Gazebo sensors and the safe VirtualGL GUI path when available.
3. No GPU: Mesa llvmpipe plus surfaceless EGL and `--headless-rendering` for
   the Gazebo server.

When a cgroup CPU quota is present, the entrypoint limits OMP, OpenBLAS, Mesa,
and Gallium thread pools to that quota. Set `ROBOTICS_CPU_CAP` to override the
detected cap; unrestricted local containers remain uncapped by default.

## Validation requirements

The patched native arm64 candidate passed the functional probe as root and
arbitrary UID `10001:0`: HTTP endpoints, advancing clock, lidar/IMU/odometry,
odom/map TF, a successful Nav2 action with observed movement and final pose,
and remove/re-spawn with live sensor data. This is candidate-image evidence,
not final-image, native amd64, OpenShift, GPU, or manual viewer acceptance.

Rebuild the image before testing: already-running containers and deployments do
not acquire updated entrypoints. Validate the viewer, robot spawn/remove,
sensor and TF data, motion behavior, and diagnostics locally and on the target
OpenShift profile. On a CPU-only OpenShift pod, confirm a spawned robot does
not crash the Gazebo sensor renderer.

Required evidence includes advancing clock, namespaced scan/IMU/odometry/TF,
spawn/remove/re-spawn, localization, and a successful Nav2 navigation action
on each architecture. CPU-only and GPU rendering, arbitrary-UID OpenShift
execution, and the managed noVNC viewer need separate validation. The updated
extension enables Humble Nav2 and automatic prewarming on Local and OpenShift.
Readiness requires map-to-base TF and active `bt_navigator`; discovery alone
is insufficient. A missing or failed Nav2 stack is not replaced with open-loop
motion. Rebuild/reload the extension before testing its Navigate workflow.

The image includes Humble Zenoh binaries, but offering that option in the
extension still requires runtime validation. Humble Zenoh cannot exchange
messages with newer ROS distribution Zenoh participants; do not infer
cross-distro interoperability from discovery alone.

The copied managed entrypoints and helpers are tested without a container via
`npm run test:scripts` from `robotics/`.
