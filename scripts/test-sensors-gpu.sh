#!/usr/bin/env bash
# Re-verify Ogre2 Sensors + GPU paths for ros2-jazzy-sim on Mac/libkrun.
# Usage: ./scripts/test-sensors-gpu.sh [image]
set -euo pipefail

IMAGE="${1:-quay.io/sgahlot/ros2-jazzy-sim:noble}"
WORLD_SRC="/opt/ros/jazzy/share/nav2_minimal_tb3_sim/worlds/tb3_sandbox.sdf.xacro"

run_test() {
  local name="$1"
  shift
  echo ""
  echo "========== $name =========="
  if "$@"; then
    echo "RESULT: PASS"
  else
    echo "RESULT: FAIL (exit $?)"
    return 1
  fi
}

test_in_container() {
  local use_gpu="$1"   # 0=llvmpipe, 1=virtio-gpu
  local with_sensors="$2"
  local dri_args=()
  local gl_env="export LIBGL_ALWAYS_SOFTWARE=1 GALLIUM_DRIVER=llvmpipe"

  if [[ "$use_gpu" == "1" ]]; then
    dri_args=(--device /dev/dri)
    gl_env="unset LIBGL_ALWAYS_SOFTWARE GALLIUM_DRIVER; export MESA_LOADER_DRIVER_OVERRIDE="
  fi

  podman run --rm ${dri_args[@]+"${dri_args[@]}"} --entrypoint /bin/bash "$IMAGE" -c "
    set -e
    source /opt/ros/jazzy/setup.bash
    export GZ_SIM_RESOURCE_PATH=\"/opt/ros/jazzy/share:/opt/ros/jazzy/share/nav2_minimal_tb3_sim/models:\${GZ_SIM_RESOURCE_PATH:-}\"
    export DISPLAY=:99
    export HOME=/tmp/test-home
    mkdir -p \"\$HOME/.config/gz/sim/8\"
    $gl_env
    echo \"GL env: LIBGL=\${LIBGL_ALWAYS_SOFTWARE:-unset} GALLIUM=\${GALLIUM_DRIVER:-unset}\"
    ls -la /dev/dri 2>&1 || echo \"(no /dev/dri)\"
    Xvfb :99 -screen 0 1024x768x16 +extension GLX +render -noreset &
    sleep 2
    WORLD_SRC=\"/opt/ros/jazzy/share/nav2_minimal_tb3_sim/worlds/tb3_sandbox.sdf.xacro\"
    if [[ \"$with_sensors\" == \"1\" ]]; then
      cp \"\$WORLD_SRC\" /tmp/test-world.sdf
      if ! grep -q gz-sim-sensors-system /tmp/test-world.sdf; then
        echo \"ERROR: upstream world missing sensors plugin\" >&2
        exit 1
      fi
      WORLD=/tmp/test-world.sdf
    else
      xacro -o /tmp/our-world.sdf /opt/ros2-demo/worlds/tb3_sandbox.sdf.xacro
      WORLD=/tmp/our-world.sdf
    fi
    echo \"World: \$WORLD\"
    timeout 20 gz sim -s -r \"\$WORLD\" &
    SPID=\$!
    sleep 4
    if ! kill -0 \$SPID 2>/dev/null; then
      echo \"Server died\"
      wait \$SPID || true
      exit 1
    fi
    timeout 15 gz sim -g 2>&1 | tail -5
    GSTAT=\${PIPESTATUS[0]:-0}
    if [[ \$GSTAT -ne 0 && \$GSTAT -ne 124 ]]; then
      echo \"GUI failed: \$GSTAT\"
      kill \$SPID 2>/dev/null || true
      exit 1
    fi
    ros2 launch nav2_minimal_tb3_sim spawn_tb3.launch.py robot_name:=sensortest x_pose:=-2.0 y_pose:=-0.5 yaw:=0.0 &
    sleep 10
    echo \"--- topics ---\"
    gz topic -l 2>/dev/null | grep -iE 'scan|camera|depth|imu' | head -10 || true
    kill \$SPID 2>/dev/null || true
    wait \$SPID 2>/dev/null || true
    echo \"done\"
  " 2>&1
}

echo "Image: $IMAGE"
echo "VM /dev/dri:"
podman machine ssh -- 'ls -la /dev/dri' 2>&1 || true

FAILED=0
for combo in "0:0:llvmpipe our-world" "0:1:llvmpipe upstream+sensors" "1:0:virtio-gpu our-world" "1:1:virtio-gpu upstream+sensors"; do
  IFS=: read -r gpu sensors _ <<< "$combo"
  if ! run_test "$combo" test_in_container "$gpu" "$sensors"; then
    FAILED=$((FAILED + 1))
  fi
done

echo ""
echo "========== Summary: $FAILED failed =========="
exit "$FAILED"
