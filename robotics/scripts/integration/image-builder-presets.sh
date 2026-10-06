#!/usr/bin/env bash
# Image Builder Presets integration (Podman). Not part of `npm test` — run via `npm run integration`.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
JAZZY_BASE_ASSET="$ROOT/packages/backend/assets/ros2-jazzy-base"
JAZZY_SIM_ASSET="$ROOT/packages/backend/assets/ros2-jazzy-sim"
SMOKE_LYRICAL_TIMEOUT_SEC="${SMOKE_LYRICAL_TIMEOUT_SEC:-600}"
SMOKE_UBUNTU_TIMEOUT_SEC="${SMOKE_UBUNTU_TIMEOUT_SEC:-900}"
FULL_LYRICAL_TIMEOUT_SEC="${FULL_LYRICAL_TIMEOUT_SEC:-3600}"
FULL_UBUNTU_TIMEOUT_SEC="${FULL_UBUNTU_TIMEOUT_SEC:-3600}"

SMOKE_IMAGE_TAGS=(
  physical-ai-integration-jazzy-base-arm64:local
  physical-ai-integration-jazzy-base-amd64:local
  physical-ai-integration-lyrical-smoke:local
)

FULL_EXTRA_IMAGE_TAGS=(
  physical-ai-integration-jazzy-sim-arm64:local
  physical-ai-integration-jazzy-sim-amd64:local
  physical-ai-integration-lyrical-full:local
)

usage() {
  cat <<'EOF'
Usage: image-builder-presets.sh [smoke|full|all]

Runs Podman builds for every Image Builder Presets quick start (see quick-starts.json):
  ubuntu-jazzy-arm64   — Phase 1 base (smoke) / base + sim (full)
  ubuntu-jazzy-amd64   — Phase 1 base (smoke) / base + sim (full)
  fedora-bootc43-lyrical-amd64 — Lyrical desktop RPMs (smoke) / full layer stack (full)

Podman build logs are hidden unless a step fails.
Built integration images are removed when each phase finishes (success or failure).

Environment:
  SMOKE_LYRICAL_TIMEOUT_SEC   default 600 (runtime-only RPM; raise if the network is slow)
  SMOKE_UBUNTU_TIMEOUT_SEC    default 900
  FULL_LYRICAL_TIMEOUT_SEC    default 3600
  FULL_UBUNTU_TIMEOUT_SEC     default 3600
EOF
}

require_podman() {
  if ! command -v podman >/dev/null 2>&1; then
    echo "error: podman not found; install Podman to run integration builds." >&2
    exit 1
  fi
}

remove_integration_images() {
  local tag removed=0
  for tag in "$@"; do
    if podman image exists "$tag" >/dev/null 2>&1; then
      if podman rmi -f "$tag" >/dev/null 2>&1; then
        removed=$((removed + 1))
      else
        echo "warning: could not remove image $tag" >&2
      fi
    fi
  done
  if [[ "$removed" -gt 0 ]]; then
    echo "==> Removed $removed integration image(s)"
  fi
}

# Run a command with stdout/stderr captured; print the log only on failure.
quiet_run() {
  local label="$1"
  shift
  local log
  log="$(mktemp)"
  echo "==> $label"
  set +e
  "$@" >"$log" 2>&1
  local status=$?
  set -e
  if [[ "$status" -ne 0 ]]; then
    echo "error: $label failed (exit $status)" >&2
    if [[ "$status" -eq 124 ]]; then
      echo "hint: command hit its timeout; increase the matching *_TIMEOUT_SEC variable" >&2
    fi
    cat "$log" >&2
    rm -f "$log"
    return 1
  fi
  rm -f "$log"
  echo "    ok"
}

emit_containerfile() {
  local mode="$1"
  local dir="$2"
  (
    cd "$ROOT"
    EMIT_CONTAINERFILE_MODE="$mode" EMIT_CONTAINERFILE_DIR="$dir" npm run test:shared -- \
      src/build/emit-containerfile.harness.spec.ts -t "writes Containerfile" >/dev/null
  )
}

jazzy_noble_image_ref() {
  node -e "
    const p = require('$ROOT/packages/shared/src/config/simulation-base-images.json')
      .presets.find(x => x.id === 'jazzy-noble');
    if (!p?.imageRef) process.exit(1);
    console.log(p.imageRef);
  "
}

stage_sim_runtime_assets() {
  local ctx="$1"
  if [[ ! -d "$JAZZY_SIM_ASSET" ]]; then
    echo "error: missing bundled sim assets at $JAZZY_SIM_ASSET" >&2
    exit 1
  fi
  cp -R "$JAZZY_SIM_ASSET"/. "$ctx/"
}

platform_for_arch() {
  case "$1" in
    amd64) echo linux/amd64 ;;
    arm64) echo linux/arm64 ;;
    *) echo "error: unknown arch $1" >&2; exit 1 ;;
  esac
}

run_ubuntu_base() {
  local arch="$1"
  local timeout_sec="$2"
  local tag="physical-ai-integration-jazzy-base-${arch}:local"
  local platform
  platform="$(platform_for_arch "$arch")"
  local ros_base
  ros_base="$(jazzy_noble_image_ref)"
  quiet_run "ubuntu-jazzy-${arch} preset — Phase 1 base ($platform)" \
    timeout "$timeout_sec" podman build --platform "$platform" \
    --build-arg "ROS_BASE_IMAGE=${ros_base}" \
    -t "$tag" \
    -f "$JAZZY_BASE_ASSET/Containerfile" \
    "$JAZZY_BASE_ASSET"
}

run_ubuntu_sim() {
  local arch="$1"
  local timeout_sec="$2"
  local base_tag="physical-ai-integration-jazzy-base-${arch}:local"
  local tag="physical-ai-integration-jazzy-sim-${arch}:local"
  local platform
  platform="$(platform_for_arch "$arch")"
  quiet_run "ubuntu-jazzy-${arch} preset — Phase 2 simulation ($platform)" \
    timeout "$timeout_sec" podman build --platform "$platform" \
    --build-arg "LOCAL_BASE_IMAGE=${base_tag}" \
    -t "$tag" \
    -f "$JAZZY_SIM_ASSET/Containerfile" \
    "$JAZZY_SIM_ASSET"
}

run_lyrical_smoke() {
  local ctx
  ctx="$(mktemp -d)"
  emit_containerfile smoke "$ctx"
  quiet_run "fedora-bootc43-lyrical-amd64 preset — smoke (desktop-runtime RPM, linux/amd64)" \
    timeout "$SMOKE_LYRICAL_TIMEOUT_SEC" podman build --platform linux/amd64 \
    -t physical-ai-integration-lyrical-smoke:local \
    -f "$ctx/Containerfile" \
    "$ctx" || {
    rm -rf "$ctx"
    return 1
  }
  rm -rf "$ctx"
}

run_lyrical_full() {
  local ctx
  ctx="$(mktemp -d)"
  emit_containerfile full "$ctx"
  stage_sim_runtime_assets "$ctx"
  quiet_run "fedora-bootc43-lyrical-amd64 preset — full layer stack (linux/amd64)" \
    timeout "$FULL_LYRICAL_TIMEOUT_SEC" podman build --platform linux/amd64 \
    -t physical-ai-integration-lyrical-full:local \
    -f "$ctx/Containerfile" \
    "$ctx" || {
    rm -rf "$ctx"
    return 1
  }
  rm -rf "$ctx"
}

run_smoke() {
  trap 'remove_integration_images "${SMOKE_IMAGE_TAGS[@]}"; trap - RETURN' RETURN
  echo "Presets integration smoke (all quick starts)"
  run_ubuntu_base arm64 "$SMOKE_UBUNTU_TIMEOUT_SEC"
  run_ubuntu_base amd64 "$SMOKE_UBUNTU_TIMEOUT_SEC"
  run_lyrical_smoke
}

run_full() {
  trap 'remove_integration_images "${SMOKE_IMAGE_TAGS[@]}" "${FULL_EXTRA_IMAGE_TAGS[@]}"; trap - RETURN' RETURN
  echo "Presets integration full (all quick starts)"
  run_ubuntu_base arm64 "$FULL_UBUNTU_TIMEOUT_SEC"
  run_ubuntu_sim arm64 "$FULL_UBUNTU_TIMEOUT_SEC"
  run_ubuntu_base amd64 "$FULL_UBUNTU_TIMEOUT_SEC"
  run_ubuntu_sim amd64 "$FULL_UBUNTU_TIMEOUT_SEC"
  run_lyrical_full
}

main() {
  local cmd="${1:-all}"
  require_podman
  case "$cmd" in
    smoke) run_smoke ;;
    full) run_full ;;
    all) run_smoke; echo; run_full ;;
    -h|--help|help) usage ;;
    *) echo "error: unknown command $cmd" >&2; usage; exit 1 ;;
  esac
  echo "==> Presets integration ($cmd) finished successfully"
}

main "$@"
