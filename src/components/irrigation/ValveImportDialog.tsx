import { useEffect, useRef, useState } from "react";
import { Upload, Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useCreateValve, type IrrigationSystem, type IrrigationValve } from "@/lib/irrigationQuery";
import { downloadCsv } from "@/lib/paddockImportExport";
import { parseValveImport, VALVE_TEMPLATE, type ValveImportRow } from "@/lib/irrigationValveImport";

export default function ValveImportDialog({ vineyardId, systems, valves }: {
  vineyardId: string; systems: IrrigationSystem[]; valves: IrrigationValve[];
}) {
  const create = useCreateValve(vineyardId);
  const [open, setOpen] = useState(false);
  const [systemId, setSystemId] = useState("");
  const [rows, setRows] = useState<ValveImportRow[]>([]);
  const [selected, setSelected] = useState<number[]>([]);
  const [results, setResults] = useState<Record<number, string>>({});
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [attempted, setAttempted] = useState(false);
  const running = useRef(false);
  const fileSequence = useRef(0);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; fileSequence.current++; }; }, []);
  const reset = () => { fileSequence.current++; setRows([]); setSelected([]); setResults({}); setError(""); setAttempted(false); };
  const load = async (file: File) => {
    const sequence = ++fileSequence.current;
    setRows([]); setSelected([]); setResults({}); setError(""); setAttempted(false);
    try {
      const text = await file.text();
      if (sequence !== fileSequence.current) return;
      const parsed = parseValveImport(text, valves.filter((v) => v.irrigation_system_id === systemId && v.is_active).map((v) => v.name));
      setRows(parsed); setSelected(parsed.filter((r) => !r.error).map((r) => r.line));
      if (!parsed.length) setError("No valve rows found.");
    } catch (e) { if (sequence === fileSequence.current) setError(e instanceof Error ? e.message : "Could not read file."); }
  };
  const save = async () => {
    if (running.current || attempted || !selected.length || !systems.some((s) => s.id === systemId)) return;
    running.current = true; setBusy(true); setAttempted(true);
    const pending = rows.filter((r) => selected.includes(r.line) && !r.error);
    try {
      for (const row of pending) {
        if (!mounted.current) break;
        try {
          await create.mutateAsync({ ...row.input, irrigation_system_id: systemId });
          if (!mounted.current) break;
          setResults((r) => ({ ...r, [row.line]: "Imported" }));
        } catch (e) {
          if (!mounted.current) break;
          setResults((r) => ({ ...r, [row.line]: `Not confirmed: ${e instanceof Error ? e.message : "Save failed"}` }));
          setError("Import stopped. Check the valve list before retrying with a new file; an unconfirmed save may have reached the server.");
          break;
        }
      }
    } finally { running.current = false; setBusy(false); }
  };
  return <>
    <Button size="sm" variant="outline" disabled={!systems.length} onClick={() => { reset(); setSystemId(systems[0]?.id ?? ""); setOpen(true); }}><Upload className="mr-1.5 h-4 w-4" />Import valves</Button>
    <Dialog open={open} onOpenChange={(value) => { if (!busy) { reset(); setOpen(value); } }}>
      <DialogContent className="max-h-[85vh] max-w-2xl overflow-y-auto">
        <DialogHeader><DialogTitle>Import valves</DialogTitle><DialogDescription>New valves only. Existing valves, systems, connections and irrigation sessions are not changed.</DialogDescription></DialogHeader>
        <Label>Irrigation system</Label>
        <Select value={systemId} disabled={busy || attempted} onValueChange={(value) => { reset(); setSystemId(value); }}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{systems.map((s) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}</SelectContent></Select>
        <div className="flex flex-wrap items-center gap-3"><Button variant="outline" size="sm" onClick={() => downloadCsv("irrigation-valves-template.csv", VALVE_TEMPLATE)}><Download className="mr-1.5 h-4 w-4" />CSV template</Button></div>
        <p className="text-sm text-muted-foreground">Plain CSV for any controller, including non-Galcon valves. Valve Name is required; Number, Config flow and Measured flow are optional. Flow rates are in L/hour.</p>
        <Label htmlFor="valve-import-file">Valve CSV file</Label><Input key={systemId} id="valve-import-file" type="file" accept=".csv,text/csv" disabled={busy || attempted || !systemId} onChange={(e) => { const file = e.target.files?.[0]; if (file) void load(file); }} />
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        {rows.length > 0 && <div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead><tr className="border-b border-border"><th className="p-2">Import</th><th className="p-2">Valve</th><th className="p-2">Number</th><th className="p-2">Configured L/h</th><th className="p-2">Measured L/h</th><th className="p-2">Status</th></tr></thead><tbody>{rows.map((row) => <tr key={row.line} className="border-b border-border"><td className="p-2"><Checkbox aria-label={`Import ${row.input.name || `row ${row.line}`}`} disabled={!!row.error || busy || attempted} checked={selected.includes(row.line)} onCheckedChange={(checked) => setSelected((s) => checked ? [...s, row.line] : s.filter((n) => n !== row.line))} /></td><td className="p-2">{row.input.name || "—"}</td><td className="p-2">{row.input.valve_number ?? "—"}</td><td className="p-2">{row.input.configured_flow_litres_per_hour ?? "—"}</td><td className="p-2">{row.input.measured_flow_litres_per_hour ?? "—"}</td><td className="p-2">{row.error ?? results[row.line] ?? (attempted ? "Not imported" : "Ready")}</td></tr>)}</tbody></table></div>}
        <DialogFooter className="sm:justify-start"><Button onClick={() => void save()} disabled={busy || attempted || !selected.length}>{busy ? "Importing…" : `Import ${selected.length} valve${selected.length === 1 ? "" : "s"}`}</Button><Button variant="outline" disabled={busy} onClick={() => { reset(); setOpen(false); }}>Close</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  </>;
}