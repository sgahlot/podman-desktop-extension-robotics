import { ROS_TOPIC_NAME_RE } from '../security/simInput';
import type { TopicInfo } from '../types/TopicInfo';

/** Parallel `ros2 topic info` jobs inside one `podman exec` (APPENG-6291). */
export const ROS_TOPIC_INFO_CONCURRENCY = 8;

/**
 * Combined `ros2 topic list` + per-topic `ros2 topic info` in one sourced bash
 * (APPENG-6291). One `podman exec` / one `source /opt/ros/.../setup.bash` instead of
 * N+1. Topic names are quoted `"$name"` from `ros2 topic list` inside the container —
 * never interpolated by the extension. Info runs in batches of
 * `ROS_TOPIC_INFO_CONCURRENCY` with per-topic temp files so parallel stdout cannot
 * interleave. Keep the `T\\t` printf in sync with `parseRosTopicListDump`.
 */
export const ROS_TOPIC_LIST_INFO_SCRIPT = `topics=$(ros2 topic list) || exit $?
[ -z "$topics" ] && exit 0
d=$(mktemp -d) || exit 1
i=0
batch=0
while IFS= read -r name; do
  [ -z "$name" ] && continue
  i=$((i+1))
  (
    printf 'T\\t%s\\n' "$name"
    ros2 topic info "$name" || true
  ) > "$d/$(printf '%05d' "$i")" &
  batch=$((batch+1))
  if [ "$batch" -ge ${ROS_TOPIC_INFO_CONCURRENCY} ]; then
    wait
    batch=0
  fi
done <<< "$topics"
wait
cat "$d"/* 2>/dev/null || true
rm -rf "$d"`;

/**
 * Parse the dump produced by `ROS_TOPIC_LIST_INFO_SCRIPT`. Records start with
 * `T<TAB>topic-name`; the following lines are `ros2 topic info` stdout (Type /
 * Publisher count / Subscription count). Names that fail `ROS_TOPIC_NAME_RE` are
 * dropped. A record with no info lines becomes type `unknown` and counts 0.
 */
export function parseRosTopicListDump(stdout: string): TopicInfo[] {
  const topics: TopicInfo[] = [];
  const records = stdout.split(/^T\t/m);
  for (const record of records) {
    if (!record) continue;
    const newline = record.indexOf('\n');
    const name = (newline === -1 ? record : record.slice(0, newline)).trim();
    if (!ROS_TOPIC_NAME_RE.test(name)) continue;
    const body = newline === -1 ? '' : record.slice(newline + 1);
    let type = 'unknown';
    let publishers = 0;
    let subscribers = 0;
    const typeMatch = body.match(/Type:\s*(.+)/);
    const pubMatch = body.match(/Publisher count:\s*(\d+)/);
    const subMatch = body.match(/Subscription count:\s*(\d+)/);
    if (typeMatch) type = typeMatch[1].trim();
    if (pubMatch) publishers = parseInt(pubMatch[1], 10);
    if (subMatch) subscribers = parseInt(subMatch[1], 10);
    topics.push({ name, type, publishers, subscribers });
  }
  return topics;
}

/**
 * Parse `ros2 topic list -t` stdout (`/name [pkg/msg/Type]`). Counts are left
 * pending so the UI can paint names/types before `ros2 topic info` finishes.
 */
export function parseRosTopicListTypes(stdout: string): TopicInfo[] {
  const topics: TopicInfo[] = [];
  for (const line of stdout.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const typed = trimmed.match(/^(\S+)\s+\[([^\]]+)\]$/);
    if (typed) {
      const name = typed[1];
      if (!ROS_TOPIC_NAME_RE.test(name)) continue;
      topics.push({
        name,
        type: typed[2].trim(),
        publishers: 0,
        subscribers: 0,
        countsPending: true,
      });
      continue;
    }
    if (ROS_TOPIC_NAME_RE.test(trimmed)) {
      topics.push({ name: trimmed, type: 'unknown', publishers: 0, subscribers: 0, countsPending: true });
    }
  }
  return topics;
}

/** True when two topic-list snapshots are field-equal in order (skip a reactive write). */
export function topicSnapshotsEqual(a: TopicInfo[], b: TopicInfo[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    const left = a[i];
    const right = b[i];
    if (
      left.name !== right.name ||
      left.type !== right.type ||
      left.publishers !== right.publishers ||
      left.subscribers !== right.subscribers ||
      Boolean(left.countsPending) !== Boolean(right.countsPending)
    ) {
      return false;
    }
  }
  return true;
}

/**
 * Overlay a fast `topic list -t` snapshot onto the current table, keeping pub/sub
 * counts for names we already fetched.
 */
export function mergeTopicSummaries(previous: TopicInfo[], summaries: TopicInfo[]): TopicInfo[] {
  const prevByName = new Map(previous.map(t => [t.name, t]));
  return summaries.map(summary => {
    const prev = prevByName.get(summary.name);
    if (prev && !prev.countsPending) {
      return {
        name: summary.name,
        type: summary.type !== 'unknown' ? summary.type : prev.type,
        publishers: prev.publishers,
        subscribers: prev.subscribers,
      };
    }
    return {
      name: summary.name,
      type: summary.type,
      publishers: 0,
      subscribers: 0,
      countsPending: true,
    };
  });
}

/** Apply pub/sub counts from the slow info dump onto the visible summary list. */
export function applyTopicCounts(previous: TopicInfo[], detailed: TopicInfo[]): TopicInfo[] {
  const detailByName = new Map(detailed.map(t => [t.name, t]));
  return previous.map(prev => {
    const detail = detailByName.get(prev.name);
    if (!detail) return prev;
    return {
      name: prev.name,
      type: detail.type !== 'unknown' ? detail.type : prev.type,
      publishers: detail.publishers,
      subscribers: detail.subscribers,
    };
  });
}
