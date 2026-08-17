#!/usr/bin/env bash
set -eo pipefail

# Gazebo simulation entrypoint — single-container Podman deployment.
# Starts noVNC display stack + Gazebo server/GUI. Optionally spawns robots
# from the ROBOTS env var (for Path A one-click builds).
#
# ROBOTS format: space-separated "name:x:y:yaw" tuples, e.g.:
#   ROBOTS="robot_1:-2.0:-0.5:0.0 robot_2:2.0:0.5:3.14159"
# Leave empty for Path B (empty world, robots added via podman exec).

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
_pai_loader="${SCRIPT_DIR}/lib/load-validate-input.sh"
[[ -f "${_pai_loader}" ]] || _pai_loader="/usr/local/lib/physical-ai/load-validate-input.sh"
if [[ ! -f "${_pai_loader}" ]]; then
  echo "error: load-validate-input.sh not found (tried ${SCRIPT_DIR}/lib/ and /usr/local/lib/physical-ai/)" >&2
  exit 1
fi
# shellcheck source=lib/load-validate-input.sh
source "${_pai_loader}"

WEB_PORT="${WEB_PORT:-8080}"
VNC_PORT="${VNC_PORT:-5900}"
NOVNC_PORT="${NOVNC_PORT:-6080}"
WORLD_NAME="${WORLD_NAME:-tb3_sandbox}"
DISPLAY_NUM="${DISPLAY_NUM:-99}"
RESOLUTION="${RESOLUTION:-1024x768x16}"
ROBOTS="${ROBOTS:-}"

# Fail closed on hostile env before starting any display/ROS processes.
pai_validate_port "${WEB_PORT}" "WEB_PORT"
pai_validate_port "${VNC_PORT}" "VNC_PORT"
pai_validate_port "${NOVNC_PORT}" "NOVNC_PORT"
pai_validate_identifier "${WORLD_NAME}" "WORLD_NAME"
pai_validate_numeric "${DISPLAY_NUM}" "DISPLAY_NUM"
if [[ ! "${RESOLUTION}" =~ ^[0-9]+x[0-9]+x[0-9]+$ ]]; then
  echo "error: invalid RESOLUTION '${RESOLUTION}' (expected WxHxD, e.g. 1024x768x16)" >&2
  exit 1
fi
pai_validate_robots_env "${ROBOTS}"

export HOME="/tmp/ros-home"
mkdir -p "${HOME}" "${HOME}/.ros" "${HOME}/.gazebo" "${HOME}/.config" "${HOME}/.gz/sim/8"
export ROS_HOME="${HOME}/.ros"
export ROS_LOG_DIR="${HOME}/.ros/log"

# shellcheck disable=SC1090
source "${PHYSICAL_AI_ROS_SETUP:-/opt/ros/jazzy/setup.bash}"

set -u

export TURTLEBOT3_MODEL="${TURTLEBOT3_MODEL:-waffle}"
export GZ_SIM_RESOURCE_PATH="/opt/ros/jazzy/share:/opt/ros/jazzy/share/nav2_minimal_tb3_sim/models:${GZ_SIM_RESOURCE_PATH:-}"

# Cap render/physics thread pools to the CPU quota so they stop oversubscribing it
# (Story 5 / story5-image-thread-caps.md). The container sees the node's nproc, but
# under a cgroup CPU quota (e.g. the OpenShift Guaranteed pod) Gazebo/Ogre/llvmpipe/
# OpenMP size their pools to nproc and burst past the quota → CFS throttling → the
# micro-stutter seen even at avg RTF ~1.0. Widening the quota (the configurable CPU
# count) helps; capping the pools removes the oversubscription at any core count.
# Cap only when a quota exists — the unlimited local (podman) path has no quota and
# no throttling, so leave it alone. Override/force with PHYSICAL_AI_CPU_CAP.
_pai_cpu_cap() {
  if [[ -n "${PHYSICAL_AI_CPU_CAP:-}" ]]; then
    echo "${PHYSICAL_AI_CPU_CAP}"
    return
  fi
  local q p
  if [[ -r /sys/fs/cgroup/cpu.max ]]; then                                              # cgroup v2
    read -r q p < /sys/fs/cgroup/cpu.max
    if [[ "${q}" != "max" && -n "${p}" && "${p}" -gt 0 ]]; then
      echo $(( (q + p - 1) / p ))
      return
    fi
  elif [[ -r /sys/fs/cgroup/cpu/cpu.cfs_quota_us && -r /sys/fs/cgroup/cpu/cpu.cfs_period_us ]]; then  # cgroup v1
    read -r q < /sys/fs/cgroup/cpu/cpu.cfs_quota_us
    read -r p < /sys/fs/cgroup/cpu/cpu.cfs_period_us
    if [[ "${q}" -gt 0 && "${p}" -gt 0 ]]; then
      echo $(( (q + p - 1) / p ))
      return
    fi
  fi
  echo ""   # no quota (unlimited) → don't cap
}
PAI_CPU_CAP="$(_pai_cpu_cap)"
if [[ -n "${PAI_CPU_CAP}" && "${PAI_CPU_CAP}" -ge 1 ]]; then
  echo "[gazebo] capping render/physics thread pools to ${PAI_CPU_CAP} CPU(s) (cgroup quota)"
  export OMP_NUM_THREADS="${OMP_NUM_THREADS:-${PAI_CPU_CAP}}"       # OpenMP (collision/physics libs)
  export OPENBLAS_NUM_THREADS="${OPENBLAS_NUM_THREADS:-${PAI_CPU_CAP}}"
  export LP_NUM_THREADS="${LP_NUM_THREADS:-${PAI_CPU_CAP}}"        # llvmpipe/Mesa software rasterizer (biggest hog)
  export MESA_NUM_THREADS="${MESA_NUM_THREADS:-${PAI_CPU_CAP}}"    # some Mesa builds read this instead
  export GALLIUM_NUM_THREADS="${GALLIUM_NUM_THREADS:-${PAI_CPU_CAP}}"
fi

# Rendering: three paths, selected by PHYSICAL_AI_USE_GPU and what GPU devices exist.
# Server-side sensor rendering (camera/lidar) is separate from the GUI canvas:
#   1. GPU + /dev/dri (Mac virtio-gpu passthrough) → GLX on the Xvfb display (hardware).
#   2. GPU but no /dev/dri (NVIDIA GPU operator in-cluster exposes /dev/nvidia*, not DRI)
#      → the *server* renders sensors off-screen via EGL pinned to the NVIDIA vendor
#      (--headless-rendering), while Xvfb + the GUI are pinned to the Mesa vendor
#      (software). With no DRI render node, letting Xvfb's GLX init bind the NVIDIA EGL
#      driver segfaults it and takes the whole display down. glvnd picks the EGL vendor by
#      priority number, which varies by cluster, so we resolve each vendor's ICD by name
#      and select it explicitly per process (see _pai_find_egl_vendor). The GUI canvas is
#      CPU-rendered here — hardware GLX for the GUI would need /dev/dri, which the operator
#      doesn't expose.
#   3. No GPU (in-cluster llvmpipe) → the sensors plugin's Ogre2/GL3Plus GLX
#      createRenderWindow SIGSEGVs, taking the whole server down. Render off-screen via
#      software EGL (surfaceless + --headless-rendering); the GUI still uses the X display.
# Resolve a glvnd EGL vendor ICD by name, e.g. _pai_find_egl_vendor nvidia. glvnd
# picks the vendor by the *lowest priority number* in egl_vendor.d, and that numbering
# is NOT stable across clusters/base images (Mesa could be 10_ and NVIDIA 50_, or vice
# versa). So we never rely on the order — we look the vendor up by name and pin it
# explicitly via __EGL_VENDOR_LIBRARY_FILENAMES. Prints the first match, or nothing.
_pai_find_egl_vendor() {  # $1: vendor substring (nvidia|mesa)
  local d f
  for d in /usr/share/glvnd/egl_vendor.d /etc/glvnd/egl_vendor.d; do
    [[ -d "${d}" ]] || continue
    for f in "${d}"/*"$1"*.json; do
      [[ -e "${f}" ]] && { echo "${f}"; return 0; }   # -e guards the no-match literal glob
    done
  done
  return 1
}

GZ_SERVER_RENDER_FLAG=""
# Env prefixes used to launch the parts with distinct GL/EGL needs. Empty by default
# (they inherit the process env); populated only on the NVIDIA no-DRI path, where the
# server is pinned to the NVIDIA EGL vendor and Xvfb/GUI to the Mesa (software) vendor.
XVFB_GUI_GL=()
GZ_SERVER_GL=()
if [[ "${PHYSICAL_AI_USE_GPU:-0}" == "1" ]] && [[ -e /dev/dri/renderD128 ]]; then
  echo "[gazebo] GPU passthrough enabled (/dev/dri present), using hardware GLX rendering"
  unset LIBGL_ALWAYS_SOFTWARE
  unset GALLIUM_DRIVER
elif [[ "${PHYSICAL_AI_USE_GPU:-0}" == "1" ]]; then
  echo "[gazebo] GPU requested without /dev/dri (assuming NVIDIA): NVIDIA EGL for the server, Mesa (software) GL for Xvfb/GUI"
  # The gz *server* renders sensors off-screen on the NVIDIA device via EGL. Leave
  # LIBGL_ALWAYS_SOFTWARE/GALLIUM unset and DON'T set EGL_PLATFORM so EGL binds the
  # NVIDIA device (not Mesa surfaceless).
  unset LIBGL_ALWAYS_SOFTWARE
  unset GALLIUM_DRIVER
  GZ_SERVER_RENDER_FLAG="--headless-rendering"

  _mesa_egl="$(_pai_find_egl_vendor mesa || true)"
  _nvidia_egl="$(_pai_find_egl_vendor nvidia || true)"

  # Server → NVIDIA vendor, pinned by name so its headless EGL binds the GPU even on a
  # cluster where Mesa has the lower glvnd priority number.
  if [[ -n "${_nvidia_egl}" ]]; then
    echo "[gazebo]   server EGL vendor: ${_nvidia_egl}"
    GZ_SERVER_GL=(env "__EGL_VENDOR_LIBRARY_FILENAMES=${_nvidia_egl}")
  else
    echo "[gazebo]   WARN: no NVIDIA EGL vendor ICD found; server EGL falls back to glvnd's default order"
  fi

  # Xvfb + GUI → Mesa vendor (software). There is no /dev/dri render node in an NVIDIA
  # operator pod, so if Xvfb's GLX init (`+extension GLX`) lets glvnd pick the NVIDIA
  # EGL vendor it binds libEGL_nvidia/libnvidia-egl-gbm and SEGFAULTs, taking the whole
  # display down (openbox/x11vnc/GUI then can't open the display). LIBGL_ALWAYS_SOFTWARE/
  # GALLIUM steer only Mesa's GL/GLX, NOT glvnd's EGL vendor choice, so we must also pin
  # __EGL_VENDOR_LIBRARY_FILENAMES at the Mesa ICD. The GUI canvas is CPU-rendered here.
  XVFB_GUI_GL=(env LIBGL_ALWAYS_SOFTWARE=1 GALLIUM_DRIVER=llvmpipe __GLX_VENDOR_LIBRARY_NAME=mesa)
  if [[ -n "${_mesa_egl}" ]]; then
    echo "[gazebo]   Xvfb/GUI EGL vendor: ${_mesa_egl}"
    XVFB_GUI_GL+=("__EGL_VENDOR_LIBRARY_FILENAMES=${_mesa_egl}")
  else
    echo "[gazebo]   WARN: no Mesa EGL vendor ICD found; Xvfb may crash binding the NVIDIA EGL driver"
  fi
else
  echo "[gazebo] Using software rendering (llvmpipe) with headless EGL for sensors..."
  export LIBGL_ALWAYS_SOFTWARE=1
  export GALLIUM_DRIVER=llvmpipe
  # Off-screen EGL via Mesa's surfaceless platform (no display, no GLX window).
  export EGL_PLATFORM=surfaceless
  GZ_SERVER_RENDER_FLAG="--headless-rendering"
fi

export DISPLAY=":${DISPLAY_NUM}"

# --- 1. Virtual framebuffer ---
echo "[gazebo] Starting Xvfb on display ${DISPLAY} at ${RESOLUTION}..."
# ${XVFB_GUI_GL[@]} is an env prefix (empty except on the NVIDIA no-DRI path, where it
# pins Xvfb's GLX to the software rasterizer so it can't segfault binding NVIDIA EGL/GBM).
# The [@]+ guard keeps the empty-array expansion safe under `set -u` on older bash.
"${XVFB_GUI_GL[@]+"${XVFB_GUI_GL[@]}"}" Xvfb "${DISPLAY}" -screen 0 "${RESOLUTION}" +extension GLX +render -noreset &
XVFB_PID=$!
sleep 2

# --- 2. Window manager ---
echo "[gazebo] Starting openbox window manager..."
openbox &

# --- 3. VNC server ---
echo "[gazebo] Starting x11vnc on port ${VNC_PORT}..."
x11vnc -display "${DISPLAY}" -rfbport "${VNC_PORT}" -shared -forever -nopw -noxdamage -noscr &

# --- 4. noVNC web proxy ---
echo "[gazebo] Starting noVNC on port ${NOVNC_PORT}..."
websockify --web /usr/share/novnc "${NOVNC_PORT}" "localhost:${VNC_PORT}" &

# --- 5. Web landing page ---
echo "[gazebo] Starting web landing page on port ${WEB_PORT}..."
python3 -m http.server "${WEB_PORT}" --directory /opt/ros2-demo/www &

# --- 6. Process world xacro and start Gazebo server ---
WORLD_SDF="/tmp/ros-home/world.sdf"

echo "[gazebo] Processing world xacro..."
xacro -o "${WORLD_SDF}" \
  "/opt/ros2-demo/worlds/tb3_sandbox.sdf.xacro"

echo "[gazebo] Starting Gazebo server..."
# ${GZ_SERVER_GL[@]} is an env prefix (empty except on the NVIDIA no-DRI path, where it
# pins the server's headless EGL to the NVIDIA vendor). ${GZ_SERVER_RENDER_FLAG} is
# intentionally unquoted: empty → no arg (GPU+DRI path), or "--headless-rendering". The
# value never contains spaces. The [@]+ guard keeps the empty-array expansion safe under
# `set -u` on older bash.
# shellcheck disable=SC2086
"${GZ_SERVER_GL[@]+"${GZ_SERVER_GL[@]}"}" gz sim -r -s ${GZ_SERVER_RENDER_FLAG} "${WORLD_SDF}" &
GZ_SERVER_PID=$!

# --- 7. Wait for Gazebo to be ready ---
echo "[gazebo] Waiting for Gazebo server to start..."
for i in $(seq 1 60); do
  if gz topic -l 2>/dev/null | grep -q "/world/${WORLD_NAME}/"; then
    echo "[gazebo] Gazebo server detected after $((i * 2))s"
    break
  fi
  sleep 2
done

# --- 8. Optionally spawn robots (Path A) ---
SIM_DIR="${PHYSICAL_AI_SIM_DIR:-/opt/ros/jazzy/share/nav2_minimal_tb3_sim}"
URDF_FILE="${SIM_DIR}/urdf/turtlebot3_waffle.urdf"

SPAWN_PIDS=()
if [ -n "${ROBOTS}" ]; then
  echo "[gazebo] Spawning robots: ${ROBOTS}"
  for spec in ${ROBOTS}; do
    IFS=: read -r rname rx ry ryaw <<< "${spec}"
    ryaw="${ryaw:-0.0}"

    echo "[gazebo] Spawning ${rname} at (${rx}, ${ry}, yaw=${ryaw})..."
    ros2 launch nav2_minimal_tb3_sim spawn_tb3.launch.py \
      use_sim_time:=True \
      namespace:="${rname}" \
      robot_name:="${rname}" \
      x_pose:="${rx}" \
      y_pose:="${ry}" \
      z_pose:=0.01 &
    SPAWN_PIDS+=($!)

    ros2 run robot_state_publisher robot_state_publisher \
      --ros-args \
      --remap __ns:=/"${rname}" \
      -p use_sim_time:=true \
      -p "robot_description:=$(cat "${URDF_FILE}")" &
  done
  echo "[gazebo] ${#SPAWN_PIDS[@]} robot(s) spawned."
else
  echo "[gazebo] No ROBOTS env var set — starting empty world (Path B)."
  echo "[gazebo] Use 'podman exec <id> /entrypoint-spawn-robot.sh <name> <x> <y> <yaw>' to add robots."
fi

# --- 9. Launch Gazebo GUI ---
# The GUI (gz sim -g) is the least latency-sensitive process here — it only draws
# for the remote noVNC viewer. Under a tight CPU quota (small in-cluster nodes,
# especially the no-DRI GPU path where the GUI canvas stays software-rendered) its
# ~3-4 cores of llvmpipe render contend with the gz *server's* physics thread, so
# the server gets scheduled late, the real-time factor swings (measured 0.4-1.4),
# and the robot's motion turns jumpy (with a transient stale-pose "double" render
# during a stall). Renicing the GUI lets physics/Nav2 win the CPU — proven live to
# steady RTF (min 0.39 -> ~0.83). It still renders full-rate when there's slack and
# only yields under load (x11vnc downsamples it for noVNC regardless). We can't
# raise the server's priority instead (that needs CAP_SYS_NICE, denied in-cluster).
# Override/disable with PHYSICAL_AI_GUI_NICE (empty = don't renice).
PHYSICAL_AI_GUI_NICE="${PHYSICAL_AI_GUI_NICE:-19}"
GUI_NICE=()
if [[ -n "${PHYSICAL_AI_GUI_NICE}" ]]; then
  if [[ "${PHYSICAL_AI_GUI_NICE}" =~ ^-?[0-9]+$ ]]; then
    GUI_NICE=(nice -n "${PHYSICAL_AI_GUI_NICE}")
  else
    echo "[gazebo] WARN: ignoring invalid PHYSICAL_AI_GUI_NICE '${PHYSICAL_AI_GUI_NICE}' (want an integer)"
  fi
fi
echo "[gazebo] Launching Gazebo GUI..."
for i in $(seq 1 30); do
  if gz topic -l 2>/dev/null | grep -q "/world/${WORLD_NAME}/"; then
    # Same software-GL prefix as Xvfb: the GUI's GLX canvas must stay off the NVIDIA
    # driver on the no-DRI path (no /dev/dri render node), else it can't connect to :99.
    # ${GUI_NICE[@]} deprioritizes it so the server/Nav2 win a saturated CPU quota.
    "${GUI_NICE[@]+"${GUI_NICE[@]}"}" "${XVFB_GUI_GL[@]+"${XVFB_GUI_GL[@]}"}" gz sim -g &
    GZ_GUI_PID=$!
    echo "[gazebo] Gazebo GUI launched."
    break
  fi
  sleep 2
done

echo "[gazebo] Simulation ready. noVNC at http://localhost:${NOVNC_PORT}"

term_handler() {
  echo "[gazebo] Shutting down..."
  kill "${GZ_GUI_PID:-}" "${SPAWN_PIDS[@]:-}" "${GZ_SERVER_PID}" "${XVFB_PID}" 2>/dev/null || true
  pkill -P $$ 2>/dev/null || true
  wait "${GZ_SERVER_PID}" 2>/dev/null || true
}

trap term_handler SIGTERM SIGINT

wait "${GZ_SERVER_PID}"
