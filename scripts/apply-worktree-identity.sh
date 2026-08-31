#!/usr/bin/env bash
# Give this worktree's Podman Desktop extension a fully unique identity so it can be
# loaded alongside other worktrees' copies without Podman Desktop's extension host
# getting stuck.
#
# A name/displayName-only suffix is NOT enough: the extension's `contributes.commands`
# id and every `physical-ai.*` configuration key are also hardcoded and shared across
# every worktree by default (registerCommand('physical-ai.open', ...) in extension.ts,
# and 18x extensionApi.configuration.getConfiguration('physical-ai') in api-impl.ts).
# Two worktrees loaded at once both declaring the same command id and the same settings
# namespace collide in Podman Desktop's extension host and can leave BOTH stuck at
# "Starting" with no Stop/Start recovery short of quitting Podman Desktop entirely.
#
# This script namespaces all of it consistently: name, displayName, command id, and
# config namespace. Every file it touches is marked `git update-index --skip-worktree`
# afterward, so this is a local-only, per-worktree override that never shows up in git
# status and is never committed.
#
# IMPORTANT — the suffixed strings live in real source files (extension.ts, api-impl.ts),
# not just package.json, so backend unit tests that assert the literal 'physical-ai'/
# 'physical-ai.open' values (extension.spec.ts, api-impl.spec.ts) WILL fail while this is
# applied. That's expected local-dev noise, not a real regression — run
#   apply-worktree-identity.sh restore
# before running the zero-errors gate or merging, then re-apply afterward if you want to
# keep testing in Podman Desktop.
#
# Usage: run from the WORKTREE'S OWN repo root you want to identify (not from main/,
# unless you're actually setting main's identity, which you never want to do):
#   /path/to/main/scripts/apply-worktree-identity.sh <JIRA-NUMBER>   e.g. ...  6250
#   /path/to/main/scripts/apply-worktree-identity.sh restore          (undo, before merging)
#
# Deliberately does NOT cd based on the script's own location ($0) — it operates on the
# current working directory's physical-ai/ tree. Run it FROM the worktree you're
# targeting, even though the script file itself lives under main/scripts/.
set -euo pipefail

MODE="${1:?Usage: apply-worktree-identity.sh <JIRA-NUMBER, e.g. 6250 | restore>}"

PKG=physical-ai/packages/backend/package.json
EXT=physical-ai/packages/backend/src/extension.ts
API=physical-ai/packages/backend/src/api-impl.ts

if [ "$(git branch --show-current 2>/dev/null)" = "main" ]; then
  echo "Refusing to run: current branch is 'main' — this script must be run from a" >&2
  echo "worktree sibling, never from main/ itself." >&2
  exit 1
fi

if [ ! -f "$PKG" ]; then
  echo "Refusing to run: $PKG not found relative to $(pwd)." >&2
  echo "Run this script FROM the worktree root you want to identify." >&2
  exit 1
fi

if [ "$MODE" = "restore" ]; then
  git update-index --no-skip-worktree "$PKG" "$EXT" "$API" 2>/dev/null || true
  git checkout -- "$PKG" "$EXT" "$API"
  echo "Restored default identity (physical-ai). Rebuilding backend..."
  (cd physical-ai && npm run -w packages/backend build)
  echo "Done. Safe to run the zero-errors gate / merge now."
  exit 0
fi

NNNN="$MODE"
SUFFIX="appeng${NNNN}"

sed -i.bak \
  -e "s/\"name\": \"physical-ai\"/\"name\": \"physical-ai-${SUFFIX}\"/" \
  -e "s/\"displayName\": \"Physical AI\"/\"displayName\": \"Physical AI (APPENG-${NNNN})\"/" \
  -e "s/\"physical-ai\./\"physical-ai-${SUFFIX}./g" \
  "$PKG"
rm "${PKG}.bak"

sed -i.bak "s/'physical-ai\.open'/'physical-ai-${SUFFIX}.open'/" "$EXT"
rm "${EXT}.bak"

sed -i.bak "s/getConfiguration('physical-ai')/getConfiguration('physical-ai-${SUFFIX}')/g" "$API"
rm "${API}.bak"

git update-index --skip-worktree "$PKG" "$EXT" "$API"

echo "Applied identity physical-ai-${SUFFIX} to $PKG, $EXT, $API (all skip-worktree'd)."
echo "Rebuilding backend..."
(cd physical-ai && npm run -w packages/backend build)

echo "Done. Reload this folder in Podman Desktop (or add it fresh) — it will register as"
echo "physical-ai-${SUFFIX} / \"Physical AI (APPENG-${NNNN})\", with its own command and settings"
echo "namespace, distinct from every other worktree."
