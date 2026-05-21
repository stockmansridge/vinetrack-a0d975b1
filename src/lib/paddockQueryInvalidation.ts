import type { Query, QueryClient } from "@tanstack/react-query";

const PREFIX_KEYS = new Set([
  "paddocks",
  "paddocks-lite",
  "paddocks-archived",
  "dashboard-paddocks",
  "irrigation-paddocks",
]);

function matchesPaddockQuery(query: Query, vineyardId?: string | null) {
  const key = query.queryKey;
  if (!Array.isArray(key) || key.length === 0) return false;

  if (key[0] === "list" && key[1] === "paddocks") {
    return !vineyardId || key[2] === vineyardId;
  }

  if (typeof key[0] === "string" && PREFIX_KEYS.has(key[0])) {
    return !vineyardId || key[1] === vineyardId;
  }

  return false;
}

export async function refreshPaddockQueries(queryClient: QueryClient, vineyardId?: string | null) {
  const predicate = (query: Query) => matchesPaddockQuery(query, vineyardId);
  await queryClient.invalidateQueries({ predicate });
  await queryClient.refetchQueries({ predicate, type: "active" });
}