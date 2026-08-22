// SQL 204 — vineyard spray target library, portal consumer hook.
//
// Offers three sources of reusable wording, in priority order:
//   1. Built-in VineTrack targets (compiled in, never stored server-side).
//   2. The vineyard's SQL 204 library.
//   3. Identifiers already present on this vineyard's own spray jobs, so an
//      existing "Phomopsis" is reusable before the table has ever been written.
import { useMemo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import {
  createVineyardSprayTarget,
  listVineyardSprayTargets,
  prettifySprayTargetIdentifier,
  isBuiltInSprayTarget,
  sprayTargetLabelMap,
  slugifySprayTarget,
} from "@/lib/sprayTargetLibrary";

async function identifiersInUse(vineyardId: string): Promise<string[]> {
  const { data, error } = await supabase
    .from("spray_jobs" as any)
    .select("targets")
    .eq("vineyard_id", vineyardId)
    .limit(500);
  if (error) return [];
  const out = new Set<string>();
  for (const row of (data ?? []) as any[]) {
    for (const t of (row?.targets ?? []) as string[]) {
      const slug = slugifySprayTarget(String(t ?? ""));
      if (slug && !isBuiltInSprayTarget(slug)) out.add(slug);
    }
  }
  return [...out];
}

export function useVineyardSprayTargets(vineyardId: string | null | undefined) {
  const qc = useQueryClient();

  const library = useQuery({
    queryKey: ["vineyard-spray-targets", vineyardId],
    enabled: !!vineyardId,
    queryFn: () => listVineyardSprayTargets(vineyardId!),
  });

  const inUse = useQuery({
    queryKey: ["vineyard-spray-targets-in-use", vineyardId],
    enabled: !!vineyardId,
    queryFn: () => identifiersInUse(vineyardId!),
  });

  const labels = useMemo(() => sprayTargetLabelMap(library.data ?? []), [library.data]);

  /** Custom identifiers the operator can pick, wording resolved best-effort. */
  const customOptions = useMemo(() => {
    const map = new Map<string, string>();
    for (const t of library.data ?? []) map.set(t.identifier, t.label);
    for (const id of inUse.data ?? []) {
      if (!map.has(id)) map.set(id, prettifySprayTargetIdentifier(id));
    }
    return [...map.entries()]
      .map(([identifier, label]) => ({ identifier, label }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [library.data, inUse.data]);

  const addTarget = useMutation({
    // Non-fatal by contract: a failure still lets the caller tag the draft.
    mutationFn: (label: string) => createVineyardSprayTarget({ vineyardId: vineyardId!, label }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["vineyard-spray-targets", vineyardId] });
    },
  });

  return { labels, customOptions, addTarget, isLoading: library.isLoading };
}
