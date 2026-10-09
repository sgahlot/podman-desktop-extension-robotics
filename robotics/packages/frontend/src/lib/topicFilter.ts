export interface NamedTopic {
  name: string;
}

/** Apply the Topic Monitor name filter without changing the source list. */
export function filterTopicsByName<T extends NamedTopic>(topics: readonly T[], query: string): T[] {
  const normalizedQuery = query.trim().toLowerCase();
  if (!normalizedQuery) return [...topics];
  return topics.filter(topic => topic.name.toLowerCase().includes(normalizedQuery));
}
