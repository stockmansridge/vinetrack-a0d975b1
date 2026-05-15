import { useMemo } from "react";
import { Navigate } from "react-router-dom";
import { Card } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import {
  useFeatureFlags,
  useIsSystemAdmin,
  useSetFeatureFlag,
  type SystemFeatureFlag,
} from "@/lib/systemAdmin";

export default function FeatureFlagsPage() {
  const { isAdmin, loading } = useIsSystemAdmin();
  const { data: flags = [], isLoading, error } = useFeatureFlags();
  const setFlag = useSetFeatureFlag();

  const grouped = useMemo(() => {
    const m = new Map<string, SystemFeatureFlag[]>();
    for (const f of flags) {
      const cat = (f.category ?? "General") || "General";
      if (!m.has(cat)) m.set(cat, []);
      m.get(cat)!.push(f);
    }
    return [...m.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [flags]);

  if (loading) return <div className="p-6 text-sm text-muted-foreground">Checking access…</div>;
  if (!isAdmin) return <Navigate to="/dashboard" replace />;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold">Feature Flags &amp; Diagnostics</h1>
        <p className="text-sm text-muted-foreground">
          Shared with the iOS app. Toggling a flag affects matching diagnostic areas in both
          platforms.
        </p>
      </div>

      {isLoading && <div className="text-sm text-muted-foreground">Loading flags…</div>}
      {error && (
        <div className="text-sm text-destructive">
          Could not load flags: {(error as Error).message}
        </div>
      )}
      {!isLoading && flags.length === 0 && !error && (
        <div className="text-sm text-muted-foreground">
          No feature flags returned. The shared <code>get_system_feature_flags()</code> RPC may not
          be deployed yet.
        </div>
      )}

      {grouped.map(([category, items]) => (
        <Card key={category} className="p-4 space-y-3">
          <div className="flex items-center gap-2">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
              {category}
            </h2>
            <Badge variant="outline">{items.length}</Badge>
          </div>
          <div className="divide-y">
            {items.map((f) => (
              <div key={f.key} className="flex items-start justify-between gap-4 py-3">
                <div className="min-w-0">
                  <div className="font-medium">{f.label ?? f.key}</div>
                  <div className="text-xs text-muted-foreground font-mono">{f.key}</div>
                  {f.description && (
                    <div className="text-xs text-muted-foreground mt-1">{f.description}</div>
                  )}
                </div>
                <Switch
                  checked={f.is_enabled}
                  disabled={setFlag.isPending}
                  onCheckedChange={(checked) =>
                    setFlag.mutate({ key: f.key, isEnabled: checked, value: f.value })
                  }
                />
              </div>
            ))}
          </div>
        </Card>
      ))}
    </div>
  );
}
