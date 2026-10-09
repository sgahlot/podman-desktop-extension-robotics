import { ROS_TOPIC_NAME_RE } from '../security/simInput';
import type { NodeDetail } from '../types/TopicInfo';

/** Keep a large simulation from turning one graph refresh into an unbounded CLI workload. */
export const ROS_TOPIC_GRAPH_NODE_LIMIT = 64;

/** One sourced exec discovers nodes and their pub/sub endpoints without host-side interpolation. */
export const ROS_TOPIC_GRAPH_DISCOVERY_SCRIPT = `nodes=$(ros2 node list) || exit $?
count=0
while IFS= read -r node; do
  [ -z "$node" ] && continue
  count=$((count+1))
  [ "$count" -gt ${ROS_TOPIC_GRAPH_NODE_LIMIT} ] && break
  printf 'N\\t%s\\n' "$node"
  ros2 node info "$node" 2>/dev/null || true
done <<< "$nodes"`;

function splitNodePath(nodePath: string): { nodeName: string; nodeNamespace: string } {
  const lastSlash = nodePath.lastIndexOf('/');
  if (lastSlash <= 0) {
    return { nodeName: nodePath.replace(/^\//, ''), nodeNamespace: '/' };
  }
  return {
    nodeName: nodePath.slice(lastSlash + 1),
    nodeNamespace: nodePath.slice(0, lastSlash) || '/',
  };
}

/** Parse the marker-delimited output emitted by ROS_TOPIC_GRAPH_DISCOVERY_SCRIPT. */
export function parseTopicGraphDiscovery(stdout: string, nodeLimit = ROS_TOPIC_GRAPH_NODE_LIMIT): NodeDetail[] {
  const nodes: NodeDetail[] = [];
  let current: NodeDetail | undefined;
  let section: 'publishers' | 'subscribers' | undefined;

  const flush = () => {
    if (current) nodes.push(current);
  };

  for (const line of stdout.split('\n')) {
    const marker = line.match(/^N\t(\/\S+)\s*$/);
    if (marker) {
      if (nodes.length >= nodeLimit) break;
      flush();
      const path = splitNodePath(marker[1]);
      current = { ...path, publishingTopics: [], subscribingTopics: [] };
      section = undefined;
      continue;
    }
    if (!current) continue;

    if (/^\s*Publishers:\s*$/.test(line)) {
      section = 'publishers';
      continue;
    }
    if (/^\s*Subscribers:\s*$/.test(line)) {
      section = 'subscribers';
      continue;
    }
    if (/^\s*(Service Servers|Service Clients|Action Servers|Action Clients):\s*$/.test(line)) {
      section = undefined;
      continue;
    }

    if (section) {
      const topic = line.match(/^\s+(\/\S+):/);
      if (topic && ROS_TOPIC_NAME_RE.test(topic[1])) {
        const target = section === 'publishers' ? current.publishingTopics : current.subscribingTopics;
        if (!target.includes(topic[1])) target.push(topic[1]);
      }
    }
  }

  flush();
  return nodes.slice(0, nodeLimit);
}
