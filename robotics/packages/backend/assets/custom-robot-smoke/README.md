# Image-embedded custom robot smoke test

This disposable derived image proves that an image-local SDF asset can be added
to the extension's already-running Gazebo world through the embedded-profile
workflow. It is deliberately **not** a supported mobile robot
profile: `boxbot` is static and has no ROS controller, bridge, sensors, or
navigation capability.

## Verify in Podman Desktop

1. Build the Step 2 simulation image in Image Builder.
2. Expand **Optional Step 3 · Embed Custom SDF Robot** and select this
   `custom-robot-smoke` directory. Build the derived image.
3. On **Simulation → Local**, select the derived image and launch it. Open the
   viewer and wait for Gazebo to settle.
4. The saved profile pre-fills the Add Robot launch. Set X/Y/yaw to `-2.0`,
   `-0.5`, and `0.75`, then add `boxbot_1`. Confirm the blue box appears at
   `(-2.0, -0.5)` with the requested yaw in the noVNC Gazebo view and the
   simulation remains running. The profile's `z: 0.15` keeps the box above the
   floor.

## Verify on OpenShift

1. In Image Builder, select **amd64** as the target architecture, then build
   Step 2 and Step 3 and push the derived image to a registry the cluster can pull.
2. On Simulation → OpenShift, deploy that derived image reference.
3. Confirm the saved profile pre-fills the robot launch fields. Set X/Y/yaw and
   add the robot; verify it appears at the requested pose and the workload stays
   ready.

The result proves embedded-asset insertion, UI pose handling, and simulation
stability. It does not make `boxbot` a supported mobile robot: that needs its
own launch package plus controller, sensor/bridge, namespace/TF, navigation, and
useful ROS-topic validation.
