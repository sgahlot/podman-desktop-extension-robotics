#!/usr/bin/env bash
# Sustained GPU-sim stability soak test for the in-cluster OpenShift GPU deploy
# (APPENG-6110). Drives an already-spawned robot continuously via cmd_vel (to keep
# the gpu_lidar sensor actively rendering) while sampling GPU health, GUI process
# identity, and noVNC liveness -- reproduces the original ~1h44m sensor-leak and
# ~1h36m GUI-leak fault windows if the fix ever regresses.
#
# Usage: ./scripts/test-gpu-sim-soak.sh [duration_seconds] [namespace] [deployment] [robot]
#   duration_seconds  total time to run (default 14400 = 4h; the original repro
#                     needed ~1h44m, so give it real margin)
#   namespace         OpenShift namespace (default: current `oc project`)
#   deployment        Deployment/app name, matches the `app=` label (default: ros2-jazzy-sim)
#   robot             Robot namespace to drive/monitor (default: robot_1) -- must
#                     already be spawned (via the extension or `ros2 launch
#                     nav2_minimal_tb3_sim spawn_tb3.launch.py`) before running this
#
# Requires: oc (logged in, correct context/project already selected), a running
# ros2-jazzy-sim GPU deployment with the robot already spawned.
#
# Prints a running sample log to stdout (one line per SAMPLE_INTERVAL_SEC) and a
# WARN line to stderr if the GPU reports a non-"None" recovery action or the GUI
# process (`gz sim -g`) disappears -- either is a sign of regression.
set -euo pipefail

DURATION_SEC="${1:-14400}"
NAMESPACE="${2:-$(oc project -q 2>/dev/null || echo default)}"
DEPLOYMENT="${3:-ros2-jazzy-sim}"
ROBOT="${4:-robot_1}"
SAMPLE_INTERVAL_SEC=120

pod() { oc get pod -n "$NAMESPACE" -l "app=$DEPLOYMENT" -o jsonpath='{.items[0].metadata.name}' 2>/dev/null; }

echo "[soak] namespace=$NAMESPACE deployment=$DEPLOYMENT robot=$ROBOT duration=${DURATION_SEC}s"
POD="$(pod)"
if [[ -z "$POD" ]]; then
  echo "[soak] ERROR: no pod found for app=$DEPLOYMENT in namespace $NAMESPACE" >&2
  exit 1
fi
echo "[soak] pod=$POD"

drive() {
  while true; do
    oc exec "$(pod)" -n "$NAMESPACE" -- bash -lc "
      export HOME=/tmp/ros-home
      source /opt/ros/jazzy/setup.bash 2>/dev/null
      timeout 4 ros2 topic pub -r 10 /$ROBOT/cmd_vel geometry_msgs/msg/Twist '{linear: {x: 0.3}}' >/dev/null 2>&1
      timeout 2 ros2 topic pub -r 10 /$ROBOT/cmd_vel geometry_msgs/msg/Twist '{angular: {z: 0.78}}' >/dev/null 2>&1
    " 2>/dev/null || true
  done
}
drive &
DRIVE_PID=$!
trap 'kill "$DRIVE_PID" 2>/dev/null || true' EXIT

echo "ts_utc | vram_MiB,util% | recovery | pod_restarts | gui_pid | novnc_http"
END=$(( $(date +%s) + DURATION_SEC ))
RST="?"
while [ "$(date +%s)" -lt "$END" ]; do
  P="$(pod)"
  RST=$(oc get pod "$P" -n "$NAMESPACE" -o jsonpath='{.status.containerStatuses[0].restartCount}' 2>/dev/null || echo "?")
  SMI=$(oc exec "$P" -n "$NAMESPACE" -- bash -lc '
    M=$(nvidia-smi --query-gpu=memory.used,utilization.gpu --format=csv,noheader,nounits 2>/dev/null)
    R=$(nvidia-smi -q 2>/dev/null | grep -i "Recovery Action" | head -1 | awk -F: "{print \$2}" | xargs)
    echo "$M | $R"
  ' 2>/dev/null || echo "? | ?")
  GUIPID=$(oc exec "$P" -n "$NAMESPACE" -- bash -lc 'pgrep -f "gz sim -g" | head -1' 2>/dev/null || true)
  NOVNC=$(oc exec "$P" -n "$NAMESPACE" -- bash -lc 'curl -s -o /dev/null -w "%{http_code}" http://localhost:6080/vnc.html 2>/dev/null' 2>/dev/null || true)
  LINE="$(date -u +%H:%M:%S) | ${SMI} | rst=${RST} | guipid=${GUIPID:-DEAD} | novnc=${NOVNC:-?}"
  echo "$LINE"
  if [[ "$SMI" == *eset* ]] || [[ -z "$GUIPID" ]]; then
    echo "[soak] WARN: possible regression — $LINE" >&2
  fi
  sleep "$SAMPLE_INTERVAL_SEC"
done

echo "[soak] done — ${DURATION_SEC}s elapsed, pod restarts=$RST"
