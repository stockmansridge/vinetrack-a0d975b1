import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import {
  V3_RESISTANCE_SCHEMES, V3_RESISTANCE_STATES, V3_RESISTANCE_STATE_LABEL,
  formatV3Resistance, formatV3ResistanceSource, readV3Resistance, suggestV3Resistance,
  type V3ResistanceDraft, type V3ResistanceScheme, type V3ResistanceState,
} from "@/lib/chemicalV3Resistance";

type Row = Record<string, any>;
const TONE = {
  classified: "border-success/40 bg-success/10",
  unresolved: "border-warning/50 bg-warning/10",
  not_applicable: "border-border bg-muted/40",
} as const;

/** Small badge for result cards: "HRAC 9". */
export function V3ResistanceBadge({ row }: { row: Row }) {
  const r = readV3Resistance(row);
  if (r.state === "not_applicable") return null;
  return (
    <Badge variant="outline" data-testid="v3-resistance-badge"
      className={r.state === "classified" ? "" : "border-warning/50 bg-warning/10"}>
      {r.state === "classified" ? formatV3Resistance(r) : "Group unresolved"}
    </Badge>
  );
}

export function V3ResistanceField({ row, editable, busy, onSave, msg }: {
  row: Row; editable: boolean; busy: boolean; onSave: (d: V3ResistanceDraft) => void;
  msg: { tone: "ok" | "err"; text: string } | null;
}) {
  const r = readV3Resistance(row);
  const suggestion = r.state === "unresolved" ? suggestV3Resistance(row) : null;
  const [editing, setEditing] = useState(false);
  // Unresolved opens straight onto Classified so the scheme + group fields are visible.
  const init = (): V3ResistanceDraft => ({
    state: r.state === "unresolved" ? "classified" : r.state,
    scheme: (V3_RESISTANCE_SCHEMES as readonly string[]).includes(r.scheme ?? "") ? (r.scheme as V3ResistanceScheme) : (suggestion?.scheme ?? ""),
    groups: r.groups.length ? r.groups.join("\n") : (suggestion?.groups.join("\n") ?? ""),
  });
  const [d, setD] = useState<V3ResistanceDraft>(init);
  useEffect(() => { if (msg?.tone === "ok") setEditing(false); }, [msg]);
  const source = formatV3ResistanceSource(r.source);
  const suggestionText = suggestion ? `${suggestion.scheme.toUpperCase()} ${suggestion.groups.join(" + ")}` : "";
  return (
    <div className={cn("rounded border p-2 text-sm sm:col-span-2", TONE[r.state])} data-status={r.state} data-testid="v3-resistance">
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="text-xs text-muted-foreground">Resistance group</div>
          <div className="font-medium" data-testid="v3-resistance-value">{formatV3Resistance(r)}</div>
          <div className="text-xs text-muted-foreground">Status: {V3_RESISTANCE_STATE_LABEL[r.state]}</div>
          {source && <div className="text-xs text-muted-foreground">Source: {source}</div>}
        </div>
        {editable && !editing && !suggestion && (
          <Button size="sm" variant="outline" className="h-7" onClick={() => { setD(init()); setEditing(true); }}>
            {r.state === "unresolved" ? "Resolve" : "Edit"}
          </Button>
        )}
      </div>
      {editable && !editing && suggestion && (
        <div className="mt-2 space-y-2 rounded border bg-card p-2" data-testid="v3-resistance-suggestion">
          <div className="text-xs text-muted-foreground">Suggested classification</div>
          <div className="font-medium">{suggestionText}</div>
          {suggestion.commonName && <div className="text-xs text-muted-foreground">{suggestion.commonName}</div>}
          <div className="flex flex-wrap gap-2">
            <Button size="sm" disabled={busy}
              onClick={() => onSave({ state: "classified", scheme: suggestion.scheme, groups: suggestion.groups.join("\n") })}>
              {busy ? "Saving…" : `Use ${suggestionText}`}
            </Button>
            <Button size="sm" variant="outline" disabled={busy} onClick={() => { setD(init()); setEditing(true); }}>Enter manually</Button>
          </div>
        </div>
      )}
      {editable && editing && (
        <div className="mt-2 space-y-2" data-testid="v3-resistance-editor">
          <label className="block text-xs text-muted-foreground">Resistance classification
            <Select value={d.state} onValueChange={(v) => setD({ ...d, state: v as V3ResistanceState })}>
              <SelectTrigger aria-label="Resistance classification" className="h-8"><SelectValue /></SelectTrigger>
              <SelectContent>{V3_RESISTANCE_STATES.map((s) => <SelectItem key={s} value={s}>{V3_RESISTANCE_STATE_LABEL[s]}</SelectItem>)}</SelectContent>
            </Select>
          </label>
          {d.state === "classified" && (
            <>
              <label className="block text-xs text-muted-foreground">Scheme
                <Select value={d.scheme || undefined} onValueChange={(v) => setD({ ...d, scheme: v as V3ResistanceScheme })}>
                  <SelectTrigger aria-label="Scheme" className="h-8"><SelectValue placeholder="Choose" /></SelectTrigger>
                  <SelectContent>{V3_RESISTANCE_SCHEMES.map((s) => <SelectItem key={s} value={s}>{s.toUpperCase()}</SelectItem>)}</SelectContent>
                </Select>
              </label>
              <label className="block text-xs text-muted-foreground">Groups (one per line)
                <Textarea aria-label="Groups" rows={2} value={d.groups} onChange={(e) => setD({ ...d, groups: e.target.value })} />
              </label>
            </>
          )}
          <div className="flex gap-2">
            <Button size="sm" disabled={busy} onClick={() => onSave(d)}>{busy ? "Saving…" : "Save resistance group"}</Button>
            <Button size="sm" variant="outline" disabled={busy} onClick={() => setEditing(false)}>Cancel</Button>
          </div>
        </div>
      )}
      {msg && <p className={cn("text-xs", msg.tone === "err" ? "text-destructive" : "text-success")}>{msg.text}</p>}
    </div>
  );
}
