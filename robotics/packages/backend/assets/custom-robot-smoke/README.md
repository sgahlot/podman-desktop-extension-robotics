# Image-embedded custom robot smoke test

This disposable derived image proves that an image-local SDF asset can be added
to the extension's already-running Gazebo world through the existing generic
package-and-launch workflow. It is deliberately **not** a supported robot
profile: `boxbot` is static and has no ROS controller, bridge, sensors, or
navigation capability.

## Build

From this directory, build the derived local image:

```bash
podman build -t localhost/ros2-jazzy-sim:custom-boxbot .
```

`BASE_IMAGE` defaults to the local Quay-tagged Jazzy simulation image, which
must already contain APPENG-6557's hardened generic launch wrapper. To test a
different compatible image, pass its full reference explicitly:

```bash
podman build --build-arg BASE_IMAGE=<simulation-image> -t localhost/ros2-jazzy-sim:custom-boxbot .
```

## Verify in Podman Desktop

1. Load this feature worktree's extension. On **Simulation → Local**, select
   `localhost/ros2-jazzy-sim:custom-boxbot` and launch it. The default local
   image allowlist recognizes the `ros2-*-sim` repository name. If local policy
   has replaced that default, add this exact image reference to the allowlist.
2. Open the running simulation in the browser and wait for Gazebo to settle.
3. In **Add robot**, use the generic image-provided configuration:

   ```text
   ROS package: ros_gz_sim
   Launch file: launch/gz_spawn_model.launch.py

   world:=tb3_sandbox
   file:=/opt/physical-ai/robots/boxbot/model.sdf
   entity_name:={name}
   allow_renaming:=False
   ```

4. Add a robot named `boxbot_1`. Confirm that the blue box appears at `(3, -1)`
   in the noVNC Gazebo view and that the simulation remains running.

The result proves only embedded-asset insertion and simulation stability. Do
not make `boxbot` selectable or document it as supported. A real profile needs
its own launch package plus controller, sensor/bridge, namespace/TF, and useful
ROS-topic validation.
