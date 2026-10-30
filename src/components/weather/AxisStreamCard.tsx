import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FlaskConical, Info } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { useIsSystemAdmin } from "@/lib/systemAdmin";
import { formatDateTime } from "@/lib/dateFormat";
import {
  AXISSTREAM_POLL_MINUTES, AXISSTREAM_TOKEN_SOURCE_URL, getAxisConfig, removeAxisConfig,
  saveAxisConfig, testAxisConnection, type AxisDevice, type AxisTestResult,
} from "@/lib/axisstreamExchange";

const NONE = "";

function StationSelect({ label, value, onChange, devices }: { label: string; value: string; onChange: (v: string) => void; devices: AxisDevice[] }) {
  const id = `axis-${label.replace(/\s+/g, "-").toLowerCase()}`;
  return (
    <div className="space-y-1">
      <Label htmlFor={id} className="text-xs">{label}</Label>
      <select id={id} aria-label={label} className="h-9 w-full rounded-md border bg-background px-2 text-sm" value={value} onChange={(e) => onChange(e.target.value)}>
        <option value={NONE}>Not selected</option>
        {devices.map((d) => <option key={d.code} value={d.code}>{d.name}{d.kind ? ` (${d.kind})` : ""}</option>)}
      </select>
    </div>
  );
}

/** System Admin-only, test-only AxisStream Exchange card. Never a selectable source. */
export function AxisStreamCard({ vineyardId }: { vineyardId: string }) {
  const { isAdmin, loading } = useIsSystemAdmin();
  if (loading || !isAdmin) return null;
  return <AxisStreamAdminCard key={vineyardId} vineyardId={vineyardId} />;
}

function AxisStreamAdminCard({ vineyardId }: { vineyardId: string }) {
  const qc = useQueryClient();
  const key = ["axisstream_exchange", vineyardId];
  const q = useQuery({ queryKey: key, queryFn: () => getAxisConfig(vineyardId), refetchOnWindowFocus: false });
  const [token, setToken] = useState("");
  const [weather, setWeather] = useState(NONE);
  const [rain, setRain] = useState(NONE);
  const [leaf, setLeaf] = useState(NONE);
  const [dirty, setDirty] = useState(false);
  const [result, setResult] = useState<AxisTestResult | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (q.data && !dirty) { setWeather(q.data.weatherCode ?? NONE); setRain(q.data.rainCode ?? NONE); setLeaf(q.data.leafCode ?? NONE); }
  }, [q.data, dirty]);

  const refresh = () => qc.invalidateQueries({ queryKey: key });
  const save = useMutation({
    mutationFn: () => saveAxisConfig(vineyardId, {
      token: token || undefined,
      mode: token.trim() ? "testing" : undefined,
      weatherCode: weather || null, rainCode: rain || null, leafCode: leaf || null,
    }),
    onMutate: () => setErr(null),
    onSuccess: () => { setToken(""); setDirty(false); refresh(); },
    onError: (e: Error) => { setToken(""); setErr(e.message); },
  });
  const test = useMutation({ mutationFn: () => testAxisConnection(vineyardId), onMutate: () => setResult(null), onSuccess: (r) => { setResult(r); refresh(); } });
  const remove = useMutation({ mutationFn: () => removeAxisConfig(vineyardId), onSuccess: () => { setResult(null); setDirty(false); refresh(); }, onError: (e: Error) => setErr(e.message) });

  const c = q.data;
  const devices = c?.devices ?? [];
  const busy = save.isPending || test.isPending || remove.isPending;
  const set = (fn: (v: string) => void) => (v: string) => { fn(v); setDirty(true); };

  return (
    <Card className="space-y-3 rounded-lg border-dashed bg-card p-4 shadow-sm" data-testid="axisstream-card">
      <div className="flex flex-wrap items-center gap-2">
        <FlaskConical className="h-5 w-5 text-muted-foreground" />
        <h3 className="text-sm font-semibold">AxisStream Exchange</h3>
        <Badge variant="outline" className="border-warning/40 bg-warning/10 text-warning">Testing only · Not active</Badge>
        <Badge variant="outline" className="text-[10px]">System Admin</Badge>
        <Badge variant="outline" className="text-[10px]">{c?.hasToken ? `Configured · ${c.mode}` : "Not configured"}</Badge>
      </div>
      <Alert><Info className="h-4 w-4" /><AlertDescription className="text-xs">
        Create a token at <a className="underline" href={AXISSTREAM_TOKEN_SOURCE_URL} target="_blank" rel="noreferrer">{AXISSTREAM_TOKEN_SOURCE_URL}</a>. The server polls AxisStream at most every {AXISSTREAM_POLL_MINUTES} minutes; Test Connection is limited and only stages readings — it does not refresh live weather, rainfall, trips or reports, and AxisStream is not selectable as a weather source.
      </AlertDescription></Alert>
      {q.isError && <p className="text-xs text-destructive">{(q.error as Error).message}</p>}
      <div className="grid gap-2 text-xs sm:grid-cols-3">
        <div><span className="text-muted-foreground">Last tested: </span>{c?.lastTestedAt ? formatDateTime(c.lastTestedAt) : "Never"}</div>
        <div><span className="text-muted-foreground">Status: </span>{c?.lastStatus ?? "—"}</div>
        <div><span className="text-muted-foreground">Summary: </span>{c?.summary ?? "—"}</div>
      </div>
      <div className="text-xs"><span className="text-muted-foreground">Discovered devices: </span>{devices.length ? devices.map((d) => d.name).join(" · ") : "None yet"}</div>
      <div className="grid gap-3 sm:grid-cols-4">
        <div className="space-y-1">
          <Label htmlFor="axis-token" className="text-xs">{c?.hasToken ? "Replace token" : "Exchange token"}</Label>
          <Input id="axis-token" type="password" autoComplete="off" spellCheck={false} placeholder={c?.hasToken ? "•••••••• (stored securely)" : "Paste token"} value={token} onChange={(e) => setToken(e.target.value)} />
        </div>
        <StationSelect label="Weather station" value={weather} onChange={set(setWeather)} devices={devices} />
        <StationSelect label="Rain gauge" value={rain} onChange={set(setRain)} devices={devices} />
        <StationSelect label="Leaf wetness" value={leaf} onChange={set(setLeaf)} devices={devices} />
      </div>
      {err && <p role="alert" className="text-xs text-destructive">{err}</p>}
      {result && <p role="status" className={`text-xs ${result.ok ? "text-success" : "text-destructive"}`}>{result.message}</p>}
      <div className="flex flex-wrap gap-2">
        <Button size="sm" disabled={busy || (!token.trim() && !dirty)} onClick={() => save.mutate()}>Save</Button>
        <Button size="sm" variant="outline" disabled={busy || !c?.hasToken || c.mode !== "testing"} onClick={() => test.mutate()}>{test.isPending ? "Testing…" : "Test Connection"}</Button>
        <Button size="sm" variant="outline" disabled={busy} onClick={refresh}>Refresh Status</Button>
        <Button size="sm" variant="outline" className="text-destructive" disabled={busy || !c?.configured} onClick={() => { if (window.confirm("Disable and remove the AxisStream test connection?")) remove.mutate(); }}>Disable/Remove</Button>
      </div>
    </Card>
  );
}
