// Shared lookup loader for the Spray Job wizard, so any page that opens the
// wizard (Spray Jobs, Resistance Planner) feeds it the same data shape.
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { fetchList } from "@/lib/queries";
import {
  fetchVineyardTeamMembers,
  memberLabel,
  type VineyardTeamMember,
} from "@/lib/sprayJobsQuery";
import type { WizardLookups } from "./types";

export function useWizardLookups(vineyardId: string | null): WizardLookups {
  const { data: paddocks } = useQuery({
    queryKey: ["paddocks-list", vineyardId],
    enabled: !!vineyardId,
    queryFn: () => fetchList("paddocks", vineyardId!),
  });
  // spray_jobs.tractor_id references public.tractors.
  // The Tractor picker therefore contains genuine tractors only.
  // Vineyard Machines use a separate machine identity and are not valid
  // values for spray_jobs.tractor_id.
  const { data: tractors } = useQuery({
    queryKey: ["tractors-list", vineyardId],
    enabled: !!vineyardId,
    queryFn: () => fetchList("tractors", vineyardId!),
  });
  const { data: equipment } = useQuery({
    queryKey: ["equipment-list", vineyardId],
    enabled: !!vineyardId,
    queryFn: () => fetchList("spray_equipment", vineyardId!),
  });
  const { data: members } = useQuery({
    queryKey: ["team-members", vineyardId],
    enabled: !!vineyardId,
    queryFn: () => fetchVineyardTeamMembers(vineyardId!),
  });

  return useMemo(() => {
    const maps = {
      paddocks: new Map<string, string>(),
      tractors: new Map<string, string>(),
      equipment: new Map<string, string>(),
      members: new Map<string, string>(),
    };
    (paddocks ?? []).forEach((p: any) =>
      maps.paddocks.set(p.id, p.name ?? p.block_name ?? "Unnamed paddock"),
    );
    (tractors ?? []).forEach((t: any) => maps.tractors.set(t.id, t.name ?? t.model ?? "Tractor"));
    (equipment ?? []).forEach((e: any) => maps.equipment.set(e.id, e.name ?? e.type ?? "Equipment"));
    ((members ?? []) as VineyardTeamMember[]).forEach((u) =>
      maps.members.set(u.user_id, memberLabel(u)),
    );
    return {
      paddocks: (paddocks ?? []) as any[],
      tractors: (tractors ?? []) as any[],
      equipment: (equipment ?? []) as any[],
      members: (members ?? []) as VineyardTeamMember[],
      maps,
    };
  }, [paddocks, tractors, equipment, members]);
}
