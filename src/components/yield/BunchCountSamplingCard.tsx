// Shared Bunch Count sampling density (sql/187).
//
// `yield_samples_per_hectare` is a VINEYARD setting shared by the portal, iOS
// and Android. There is deliberately no portal-only copy: the displayed value
// is always the value returned by the shared RPC, re-read after every save.
import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { toast } from "@/hooks/use-toast";
import {
  canEditYieldSampling,
  fetchYieldSamplingSettings,
  setYieldSamplingSettings,
  DEFAULT_SAMPLES_PER_HECTARE,
  MIN_SAMPLES_PER_HECTARE,
  MAX_SAMPLES_PER_HECTARE,
} from "@/lib/yieldSamplingSettingsQuery";

export default function BunchCountSamplingCard({
  vineyardId,
  role,
}: {
  vineyardId: string | null;
  role: string | null;
}) {
  const qc = useQueryClient();
  const canEdit = canEditYieldSampling(role);

  const q = useQuery({
    queryKey: ["yield_sampling_settings", vineyardId],
    enabled: !!vineyardId,
    queryFn: () => fetchYieldSamplingSettings(vineyardId!),
  });

  const effective = q.data ?? null;
  const [draft, setDraft] = useState<string>("");

  // The shared value is authoritative — the field mirrors it whenever it changes.
  useEffect(() => {
    setDraft(effective != null ? String(effective) : "");
  }, [effective]);

  const save = useMutation({
    mutationFn: async () => setYieldSamplingSettings(vineyardId!, Number(draft)),
    onSuccess: async () => {
      toast({ title: "Sampling density saved" });
      // Re-read the shared value rather than trusting the local draft.
      await qc.invalidateQueries({ queryKey: ["yield_sampling_settings", vineyardId] });
    },
    onError: (e: any) =>
      toast({
        // Surface the real backend validation message, never a portal guess.
        title: "Could not save sampling density",
        description: e?.message ?? String(e),
        variant: "destructive",
      }),
  });

  const dirty = draft.trim() !== "" && Number(draft) !== effective;

  return (
    <Card className="p-4 space-y-2">
      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-[220px]">
          <div className="font-medium leading-tight">Bunch Count Sampling</div>
          <p className="text-xs text-muted-foreground mt-1 max-w-xl">
            Default number of bunch-count sample points generated per hectare. This setting is
            shared across VineTrack devices for this vineyard.
          </p>
        </div>
        <div className="space-y-1">
          <label htmlFor="samples-per-hectare" className="text-xs text-muted-foreground block">
            Samples per hectare
          </label>
          <Input
            id="samples-per-hectare"
            aria-label="Samples per hectare"
            type="number"
            min={MIN_SAMPLES_PER_HECTARE}
            max={MAX_SAMPLES_PER_HECTARE}
            className="w-28"
            value={draft}
            disabled={!canEdit || q.isLoading}
            onChange={(e) => setDraft(e.target.value)}
          />
        </div>
        {canEdit && (
          <Button size="sm" disabled={!dirty || save.isPending} onClick={() => save.mutate()}>
            {save.isPending ? "Saving…" : "Save"}
          </Button>
        )}
      </div>
      <div className="text-xs text-muted-foreground">
        {q.isLoading
          ? "Loading shared setting…"
          : q.error
          ? `Could not load shared setting: ${(q.error as Error).message}`
          : `Current shared value: ${effective ?? DEFAULT_SAMPLES_PER_HECTARE} samples per hectare${
              effective == null ? " (default)" : ""
            }`}
        {!canEdit && " · Your role cannot change this setting."}
      </div>
    </Card>
  );
}
