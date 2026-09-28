#!/usr/bin/env bash

set -u

if (($# == 0)); then
  printf 'Usage: %s <command> [args...]\n' "$0" >&2
  exit 2
fi

log_file="${TMPDIR:-/tmp}/physical-ai-agent-$(date +%Y%m%d-%H%M%S)-$$.log"

if "$@" >"$log_file" 2>&1; then
  printf 'PASS: %s\n' "$*"
  printf 'Full output: %s\n' "$log_file"
  exit 0
fi

status=$?
printf 'FAIL (%d): %s\n' "$status" "$*" >&2
printf 'Last 80 lines:\n' >&2
tail -n 80 "$log_file" >&2
printf 'Full output: %s\n' "$log_file" >&2
exit "$status"
