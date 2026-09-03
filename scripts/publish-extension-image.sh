#!/usr/bin/env bash
# Build and publish the Physical AI Podman Desktop extension as an OCI image, so other
# teams can install it via Podman Desktop → Extensions → "Install custom extension…"
# with just an image reference (no clone / npm install / build on their side).
#
# The image is the artifact described by physical-ai/Containerfile (the io.podman-desktop.*
# labels are what make Podman Desktop recognize it as an installable extension).
#
# Usage (run from anywhere inside the repo; operates on the repo's physical-ai/ tree):
#   scripts/publish-extension-image.sh <quay-repo> [tag]
#
#   <quay-repo>   target repo WITHOUT a tag, e.g. quay.io/rhrobotics/physical-ai
#   [tag]         optional; defaults to the extension version from backend package.json.
#                 The image is always ALSO tagged :latest.
#
# Flags:
#   --no-push        build the image locally but do not push (dry run of the build)
#   --allow-nonmain  skip the "must be on main" guard (escape hatch; see below)
#
# SAFEGUARDS (why this refuses to run in some states):
#   1. Branch guard    — images are only ever published from `main`. By worktree
#                        convention `main` is only checked out in main/, so this also
#                        enforces "publish from the main worktree." Override with
#                        --allow-nonmain if you really mean it.
#   2. Identity guard  — refuses if apply-worktree-identity.sh has suffixed the extension
#                        (name/command/config namespace). A published image MUST carry the
#                        canonical `physical-ai` identity, never a per-worktree `-appengNNNN`
#                        one. Fix by running:  scripts/apply-worktree-identity.sh restore
set -euo pipefail

REPO=""
TAG=""
PUSH=1
ALLOW_NONMAIN=0

while [ $# -gt 0 ]; do
  case "$1" in
    --no-push)       PUSH=0 ;;
    --allow-nonmain) ALLOW_NONMAIN=1 ;;
    -h|--help)       sed -n '2,30p' "$0"; exit 0 ;;
    -*)              echo "Unknown flag: $1" >&2; exit 2 ;;
    *)               if [ -z "$REPO" ]; then REPO="$1"; elif [ -z "$TAG" ]; then TAG="$1"; else
                       echo "Unexpected extra argument: $1" >&2; exit 2; fi ;;
  esac
  shift
done

if [ -z "$REPO" ]; then
  echo "Usage: publish-extension-image.sh <quay-repo> [tag] [--no-push] [--allow-nonmain]" >&2
  echo "  e.g. publish-extension-image.sh quay.io/rhrobotics/physical-ai" >&2
  exit 2
fi

ROOT="$(git rev-parse --show-toplevel)"
EXT_DIR="$ROOT/physical-ai"
BACKEND_PKG="$EXT_DIR/packages/backend/package.json"
EXT_TS="$EXT_DIR/packages/backend/src/extension.ts"
API_TS="$EXT_DIR/packages/backend/src/api-impl.ts"

# --- Safeguard 1: branch --------------------------------------------------------------
BRANCH="$(git -C "$ROOT" branch --show-current 2>/dev/null || true)"
if [ "$BRANCH" != "main" ] && [ "$ALLOW_NONMAIN" -ne 1 ]; then
  echo "Refusing to publish: current branch is '${BRANCH:-<detached>}', not 'main'." >&2
  echo "Images are published only from main (i.e. from the main/ worktree)." >&2
  echo "Pass --allow-nonmain to override if you really intend to." >&2
  exit 1
fi

# --- Safeguard 2: canonical (un-suffixed) identity ------------------------------------
BACKEND_NAME="$(node -p "require('$BACKEND_PKG').name")"
if [ "$BACKEND_NAME" != "physical-ai" ]; then
  echo "Refusing to publish: backend package name is '$BACKEND_NAME', not 'physical-ai'." >&2
  echo "A per-worktree identity suffix looks applied. Restore canonical identity first:" >&2
  echo "  scripts/apply-worktree-identity.sh restore" >&2
  exit 1
fi
# Match the exact suffix apply-worktree-identity.sh writes (physical-ai-appengNNNN in the
# command id / config namespace) — NOT a bare "appeng", which collides with legitimate
# strings like the default quay namespace 'ecosystem-appeng'.
if grep -qE "physical-ai-appeng[0-9]" "$EXT_TS" "$API_TS" 2>/dev/null; then
  echo "Refusing to publish: a worktree identity suffix ('physical-ai-appengNNNN') is present in" >&2
  echo "  $EXT_TS / $API_TS" >&2
  echo "Restore canonical identity first:  scripts/apply-worktree-identity.sh restore" >&2
  exit 1
fi

# --- Tags -----------------------------------------------------------------------------
VERSION="$(node -p "require('$BACKEND_PKG').version")"
TAG="${TAG:-$VERSION}"
IMG_VER="${REPO}:${TAG}"
IMG_LATEST="${REPO}:latest"

# Ship a multi-arch manifest so both Apple-silicon (arm64) and Linux/amd64 testers get an
# installable image. The extension content (compiled JS + text assets) is arch-independent
# and the Containerfile has no RUN step, so building for a non-native arch needs no
# emulation — it just stamps the per-arch manifest entry. Override with PLATFORMS=… if
# you ever need a single arch.
PLATFORMS="${PLATFORMS:-linux/amd64,linux/arm64}"

# Snapshot dangling ("<none>") image IDs before touching anything, so cleanup at the end
# can remove only what THIS run adds — never unrelated dangling images already sitting in
# local storage from other work.
DANGLING_BEFORE="$(podman images -q -f dangling=true 2>/dev/null | sort -u)"

echo "==> Building extension (npm run build)"
(cd "$EXT_DIR" && npm run build)

echo "==> Building multi-arch OCI image  ($PLATFORMS)"
echo "      $IMG_VER  (also pushed as :latest)"
# Create the manifest list explicitly, then add each arch in its own build. The one-shot
# `--platform a,b --manifest` form collapses to a single image when the per-arch content
# is byte-identical (which it is here: same JS/assets FROM scratch), so it must be built
# per-platform. Start clean, else a stale list from a previous run keeps old entries.
podman manifest rm "$IMG_VER" 2>/dev/null || true
podman manifest create "$IMG_VER" >/dev/null
IFS=',' read -ra _PLATS <<< "$PLATFORMS"
for _p in "${_PLATS[@]}"; do
  echo "    - building $_p"
  podman build --platform "$_p" --manifest "$IMG_VER" -f "$EXT_DIR/Containerfile" "$EXT_DIR" >/dev/null
done

echo "==> Manifest contents:"
podman manifest inspect "$IMG_VER" | node -e 'const m=JSON.parse(require("fs").readFileSync(0));for(const x of m.manifests||[])console.log("      -",x.platform.os+"/"+x.platform.architecture,x.digest)'

if [ "$PUSH" -ne 1 ]; then
  echo "==> --no-push set; built locally, not pushing."
  echo "    Inspect:  podman manifest inspect $IMG_VER"
  echo "    (dangling per-arch build images are left in place so you can inspect/push"
  echo "     manually; they're only auto-cleaned after a real push)"
  exit 0
fi

# Push the one manifest list to both the version tag and :latest.
echo "==> Pushing manifest list (all arches)"
podman manifest push --all "$IMG_VER" "docker://$IMG_VER"
podman manifest push --all "$IMG_VER" "docker://$IMG_LATEST"

# Clean up the dangling per-arch/builder-stage images this run produced. Safe only now
# that the push succeeded (the registry has its own copy; local blobs are disposable) —
# local storage keeps the manifest list's digest metadata independently of the blobs, so
# removing the underlying images does not break `podman manifest inspect` on $IMG_VER.
# Only IDs that are newly dangling since this run started are removed — anything that was
# already dangling before (unrelated to this script) is left untouched. Removed one at a
# time: a batched `podman rmi id1 id2 ...` can abort partway through on the first error.
echo "==> Cleaning up local build layers from this run"
DANGLING_AFTER="$(podman images -q -f dangling=true 2>/dev/null | sort -u)"
NEW_DANGLING="$(comm -13 <(printf '%s\n' "$DANGLING_BEFORE") <(printf '%s\n' "$DANGLING_AFTER") | grep -v '^$' || true)"
if [ -n "$NEW_DANGLING" ]; then
  REMOVED=0
  while IFS= read -r _id; do
    podman rmi "$_id" >/dev/null 2>&1 && REMOVED=$((REMOVED + 1))
  done <<< "$NEW_DANGLING"
  echo "    removed $REMOVED image(s)"
else
  echo "    nothing to clean up"
fi

echo "==> Done."
echo "    Testers install via Podman Desktop → Extensions → Install custom extension…"
echo "    Image reference:  $IMG_VER   (or ${REPO}:latest)"
