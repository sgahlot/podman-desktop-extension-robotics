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
# GPU-GUI (VirtualGL) launch prefix + flag. Populated only on the NVIDIA no-DRI path
# when VirtualGL and an NVIDIA EGL vendor ICD are both present; then the GUI renders on
# the GPU via `vglrun -d egl` instead of the llvmpipe CPU rasterizer (APPENG-6083).
VGL_GUI=()
GUI_GPU=0
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

  # GPU-render the GUI viewport on the NVIDIA headless EGL device via VirtualGL, instead
  # of the llvmpipe CPU rasterizer, to end the CFS CPU throttling that made navigation
  # jumpy (APPENG-6083). vglrun -d egl uses the SAME headless EGL device the server
  # already uses for sensors (no /dev/dri needed); Xvfb :99 stays the 2D/window-system
  # side that VGL reads frames back into for x11vnc. Requires VirtualGL in the image and
  # an NVIDIA EGL vendor ICD. Falls back to the software (llvmpipe) GUI path when either
  # is missing, or when disabled via PHYSICAL_AI_GUI_GPU=0.
  PHYSICAL_AI_GUI_GPU="${PHYSICAL_AI_GUI_GPU:-1}"
  if [[ "${PHYSICAL_AI_GUI_GPU}" == "1" ]] && command -v vglrun >/dev/null 2>&1 && [[ -n "${_nvidia_egl}" ]]; then
    GUI_GPU=1
    # Pin the GUI's EGL vendor to NVIDIA so VGL's EGL back end binds the GPU. No Mesa/
    # llvmpipe steering and no llvmpipe thread clamp are applied to the GUI on this path
    # (those only affect the software rasterizer, which VGL bypasses).
    VGL_GUI=(env "__EGL_VENDOR_LIBRARY_FILENAMES=${_nvidia_egl}" VGL_LOGO=0)
    # Optional frame-rate cap for VGL readback (empty disables). Bounds the GPU->X
    # readback/event loop cost; the browser can't perceive more via x11vnc downsampling.
    PHYSICAL_AI_GUI_VGL_FPS="${PHYSICAL_AI_GUI_VGL_FPS:-30}"
    if [[ -n "${PHYSICAL_AI_GUI_VGL_FPS}" ]]; then
      if [[ "${PHYSICAL_AI_GUI_VGL_FPS}" =~ ^[0-9]+$ ]] && [[ "${PHYSICAL_AI_GUI_VGL_FPS}" -ge 1 ]]; then
        VGL_GUI+=("VGL_FPS=${PHYSICAL_AI_GUI_VGL_FPS}")
      else
        echo "[gazebo]   WARN: ignoring invalid PHYSICAL_AI_GUI_VGL_FPS '${PHYSICAL_AI_GUI_VGL_FPS}' (want a positive integer)"
      fi
    fi
    echo "[gazebo]   GUI: GPU-rendered via VirtualGL EGL back end (NVIDIA, VGL_FPS=${PHYSICAL_AI_GUI_VGL_FPS:-uncapped})"
  else
    echo "[gazebo]   GUI: software-rendered (llvmpipe); VirtualGL GPU-GUI unavailable or disabled"
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
# The GUI (gz sim -g) canvas is software-rendered (llvmpipe) whenever there's no
# /dev/dri render node — i.e. the no-GPU path AND the NVIDIA-operator GPU path (the
# GPU only offloads the *server's* sensor render, never the GUI viewport). Its cost
# is llvmpipe *rasterizer* threads, and the GUI free-runs (renders as fast as it
# can), so it consumes ~1 core PER llvmpipe thread. The global thread cap sizes that
# pool to the whole CPU quota (e.g. 7), which is exactly backwards for the GUI: it
# then burns ~3-4 cores rasterizing frames no one needs that fast and starves the
# gz *server's* physics thread, so the real-time factor swings (measured 0.39-1.46)
# and the robot's motion turns jumpy (with a transient stale-pose "double" render
# during a stall). Two clamps, both proven live in-cluster:
#   1. GUI llvmpipe threads -> 2 (PHYSICAL_AI_GUI_LP_THREADS): caps the GUI at ~2
#      cores instead of ~3.5, freeing the rest for the server + Nav2. Measured: GUI
#      350% -> 170%, RTF snapped to a rock-steady ~1.000 (was 0.39-1.46). x11vnc
#      downsamples the GUI for noVNC anyway, so the lower frame rate is invisible.
#   2. renice the GUI down (PHYSICAL_AI_GUI_NICE, default 19): belt-and-suspenders
#      so physics/Nav2 still win any residual contention (we can't raise the
#      server's priority instead — negative nice needs CAP_SYS_NICE, denied in-cluster).
# Set PHYSICAL_AI_GUI_LP_THREADS= (empty) or PHYSICAL_AI_GUI_NICE= (empty) to disable.
PHYSICAL_AI_GUI_NICE="${PHYSICAL_AI_GUI_NICE:-19}"
GUI_NICE=()
if [[ -n "${PHYSICAL_AI_GUI_NICE}" ]]; then
  if [[ "${PHYSICAL_AI_GUI_NICE}" =~ ^-?[0-9]+$ ]]; then
    GUI_NICE=(nice -n "${PHYSICAL_AI_GUI_NICE}")
  else
    echo "[gazebo] WARN: ignoring invalid PHYSICAL_AI_GUI_NICE '${PHYSICAL_AI_GUI_NICE}' (want an integer)"
  fi
fi
PHYSICAL_AI_GUI_LP_THREADS="${PHYSICAL_AI_GUI_LP_THREADS:-2}"
GUI_THREADS=()
if [[ -n "${PHYSICAL_AI_GUI_LP_THREADS}" ]]; then
  if [[ "${PHYSICAL_AI_GUI_LP_THREADS}" =~ ^[0-9]+$ ]] && [[ "${PHYSICAL_AI_GUI_LP_THREADS}" -ge 1 ]]; then
    GUI_THREADS=(env
      "LP_NUM_THREADS=${PHYSICAL_AI_GUI_LP_THREADS}"
      "GALLIUM_NUM_THREADS=${PHYSICAL_AI_GUI_LP_THREADS}"
      "MESA_NUM_THREADS=${PHYSICAL_AI_GUI_LP_THREADS}")
  else
    echo "[gazebo] WARN: ignoring invalid PHYSICAL_AI_GUI_LP_THREADS '${PHYSICAL_AI_GUI_LP_THREADS}' (want a positive integer)"
  fi
fi
if [[ "${GUI_GPU}" == "1" ]]; then
  echo "[gazebo] Launching Gazebo GUI (GPU via VirtualGL, nice=${PHYSICAL_AI_GUI_NICE:-none})..."
else
  echo "[gazebo] Launching Gazebo GUI (llvmpipe threads=${PHYSICAL_AI_GUI_LP_THREADS:-inherit}, nice=${PHYSICAL_AI_GUI_NICE:-none})..."
fi
for i in $(seq 1 30); do
  if gz topic -l 2>/dev/null | grep -q "/world/${WORLD_NAME}/"; then
    if [[ "${GUI_GPU}" == "1" ]]; then
      # GPU path: render on the NVIDIA EGL device via VirtualGL. VGL_GUI pins the NVIDIA
      # EGL vendor (+ optional VGL_FPS cap); no Mesa/llvmpipe steering or thread clamp is
      # applied (VGL bypasses the software rasterizer). nice still deprioritizes the GUI's
      # readback/event loop so physics/Nav2 win any residual contention.
      "${GUI_NICE[@]+"${GUI_NICE[@]}"}" "${VGL_GUI[@]}" vglrun -d egl gz sim -g &
    else
      # Software path: prefixes stack — nice (deprioritize) + XVFB_GUI_GL (software GL/
      # Mesa EGL on the no-DRI path; empty elsewhere) + GUI_THREADS (clamp the llvmpipe
      # pool). All use the [@]+ guard so an empty array expands to nothing under `set -u`.
      "${GUI_NICE[@]+"${GUI_NICE[@]}"}" "${XVFB_GUI_GL[@]+"${XVFB_GUI_GL[@]}"}" "${GUI_THREADS[@]+"${GUI_THREADS[@]}"}" gz sim -g &
    fi
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
