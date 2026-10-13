export interface NamedTopic {
  name: string;
}

/** Apply the Topic Monitor name filter without changing the source list. */
export function filterTopicsByName<T extends NamedTopic>(topics: readonly T[], query: string): T[] {
  const normalizedQuery = query.trim().toLowerCase();
  if (!normalizedQuery) return [...topics];
  return topics.filter(topic => topic.name.toLowerCase().includes(normalizedQuery));
}

/** Organize already-filtered topics by their parent path, retaining discovery order. */
export function groupTopicsByNamespace<T extends NamedTopic>(topics: readonly T[]): [string, T[]][] {
  const groups = new Map<string, T[]>();
  for (const topic of topics) {
    const parent = topic.name.slice(0, topic.name.lastIndexOf('/')) || '/';
    const group = groups.get(parent) ?? [];
    group.push(topic);
    groups.set(parent, group);
  }
  return Array.from(groups);
}
