#!/usr/bin/env bash
set -euo pipefail

CONTAINER_ID="${1:-}"
SUBSCRIBER_COUNT="${2:-3}"
TOPIC="${3:-/test/messages}"

if [[ -z "${CONTAINER_ID}" || ! "${SUBSCRIBER_COUNT}" =~ ^[1-9][0-9]*$ ]]; then
  printf 'Usage: %s <container-id> [subscriber-count] [topic]\n' "$0" >&2
  exit 2
fi

for ((i = 1; i <= SUBSCRIBER_COUNT; i++)); do
  podman exec -d "$CONTAINER_ID" bash -lc \
    "source /opt/ros/jazzy/setup.bash && exec ros2 topic echo '$TOPIC' std_msgs/msg/String"
done

printf 'Started %s subscribers on %s in %s.\n' "$SUBSCRIBER_COUNT" "$TOPIC" "$CONTAINER_ID"
printf 'Verify with: podman exec %s bash -lc "source /opt/ros/jazzy/setup.bash && ros2 topic info %s -v"\n' \
  "$CONTAINER_ID" "$TOPIC"
