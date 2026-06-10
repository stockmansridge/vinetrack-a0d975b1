// Spray Program import dialog — upload .xlsx, preview, confirm.
// Creates draft spray_jobs only. Never writes to spray_records.
import { useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Upload, AlertTriangle, CheckCircle2, XCircle, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import {
  buildImportContext, parseAndValidate, importRows,
  type ImportContext, type ImportedRow, type ImportResult,
} from "@/lib/sprayProgramImport";

export function SprayProgramImportDialog({
  open, onOpenChange, vineyardId,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  vineyardId: string;
}) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const [parsing, setParsing] = useState(false);
  const [importing, setImporting] = useState(false);
  const [rows, setRows] = useState<ImportedRow[] | null>(null);
  const [results, setResults] = useState<ImportResult[] | null>(null);
  const [ctx, setCtx] = useState<ImportContext | null>(null);

  const reset = () => {
    setRows(null); setResults(null); setCtx(null);
    if (fileRef.current) fileRef.current.value = "";
  };
  const handleClose = (o: boolean) => {
    if (!o) reset();
    onOpenChange(o);
  };

  const onFile = async (file: File) => {
    setParsing(true);
    try {
      const c = ctx ?? await buildImportContext(vineyardId);
      setCtx(c);
      const buf = await file.arrayBuffer();
      const parsed = await parseAndValidate(buf, c);
      setRows(parsed);
      setResults(null);
      if (!parsed.length) toast({ title: "No data rows found", variant: "destructive" });
    } catch (e: any) {
      toast({ title: "Parse failed", description: e?.message ?? String(e), variant: "destructive" });
    } finally {
      setParsing(false);
    }
  };

  const onConfirm = async () => {
    if (!rows || !ctx) return;
    const importable = rows.filter((r) => r.errors.length === 0);
    if (!importable.length) {
      toast({ title: "Nothing to import", description: "All rows have errors.", variant: "destructive" });
      return;
    }
    setImporting(true);
    try {
      const res = await importRows(importable, ctx);
      setResults(res);
      const ok = res.filter((r) => r.status === "imported" || r.status === "imported_with_warnings").length;
      const failed = res.filter((r) => r.status === "failed").length;
      toast({
        title: `Imported ${ok} draft job${ok === 1 ? "" : "s"}`,
        description: failed ? `${failed} failed — see results.` : undefined,
      });
      qc.invalidateQueries({ queryKey: ["spray_jobs", vineyardId] });
    } catch (e: any) {
      toast({ title: "Import failed", description: e?.message ?? String(e), variant: "destructive" });
    } finally {
      setImporting(false);
    }
  };

  const totals = rows ? {
    total: rows.length,
    valid: rows.filter((r) => r.errors.length === 0 && r.warnings.length === 0).length,
    warnings: rows.filter((r) => r.errors.length === 0 && r.warnings.length > 0).length,
    errors: rows.filter((r) => r.errors.length > 0).length,
  } : null;

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-5xl">
        <DialogHeader>
          <DialogTitle>Import spray program</DialogTitle>
          <DialogDescription>
            Upload a completed template. Each row becomes a <strong>draft planned spray job</strong>.
            Nothing is written to spray records. Rows with errors are skipped.
          </DialogDescription>
        </DialogHeader>

        {!rows && (
          <div className="flex flex-col items-center justify-center gap-3 py-10 border-2 border-dashed rounded-lg">
            <Upload className="h-8 w-8 text-muted-foreground" />
            <input
              ref={fileRef}
              type="file"
              accept=".xlsx"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) onFile(f);
              }}
            />
            <Button onClick={() => fileRef.current?.click()} disabled={parsing}>
              {parsing ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Parsing…</> : "Choose .xlsx file"}
            </Button>
            <p className="text-xs text-muted-foreground">Use the downloaded template for column structure.</p>
          </div>
        )}

        {rows && totals && !results && (
          <div className="space-y-3 max-h-[60vh] overflow-auto">
            <div className="flex flex-wrap gap-2">
              <Badge variant="secondary">{totals.total} rows</Badge>
              <Badge className="bg-green-600/15 text-green-700 hover:bg-green-600/15">{totals.valid} valid</Badge>
              {totals.warnings > 0 && (
                <Badge className="bg-amber-600/15 text-amber-700 hover:bg-amber-600/15">{totals.warnings} warnings</Badge>
              )}
              {totals.errors > 0 && (
                <Badge variant="destructive">{totals.errors} errors (will skip)</Badge>
              )}
            </div>
            <Card className="overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-10">Row</TableHead>
                    <TableHead className="w-10"></TableHead>
                    <TableHead>Name</TableHead>
                    <TableHead>Date</TableHead>
                    <TableHead>Blocks</TableHead>
                    <TableHead>Chemicals</TableHead>
                    <TableHead>Notes / Issues</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((r) => {
                    const status = r.errors.length ? "error" : r.warnings.length ? "warn" : "ok";
                    return (
                      <TableRow key={r.excelRow}>
                        <TableCell className="text-xs">{r.excelRow}</TableCell>
                        <TableCell>
                          {status === "ok" && <CheckCircle2 className="h-4 w-4 text-green-600" />}
                          {status === "warn" && <AlertTriangle className="h-4 w-4 text-amber-600" />}
                          {status === "error" && <XCircle className="h-4 w-4 text-destructive" />}
                        </TableCell>
                        <TableCell className="font-medium">
                          {r.name || "—"}
                          {r.is_template && (
                            <Badge variant="outline" className="ml-2 text-[10px]">Template</Badge>
                          )}
                        </TableCell>
                        <TableCell className="text-xs">{r.is_template ? "—" : (r.planned_date ?? "—")}</TableCell>
                        <TableCell className="text-xs">{r.paddockNames.join(", ") || "—"}</TableCell>
                        <TableCell className="text-xs">
                          {r.chemical_lines.length
                            ? r.chemical_lines.map((c) => `${c.name} (${c.rate} ${c.unit})`).join(", ")
                            : "—"}
                        </TableCell>
                        <TableCell className="text-xs">
                          {r.errors.map((e, i) => (
                            <div key={`e${i}`} className="text-destructive">• {e}</div>
                          ))}
                          {r.warnings.map((w, i) => (
                            <div key={`w${i}`} className="text-amber-700">• {w}</div>
                          ))}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </Card>
          </div>
        )}

        {results && (
          <div className="space-y-2 max-h-[60vh] overflow-auto">
            <div className="text-sm">
              <strong>{results.filter((r) => r.status === "imported" || r.status === "imported_with_warnings").length}</strong>
              {" "}draft jobs created.
              {results.filter((r) => r.status === "failed").length > 0 && (
                <span className="text-destructive">
                  {" "}{results.filter((r) => r.status === "failed").length} failed.
                </span>
              )}
            </div>
            <Card className="overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Row</TableHead>
                    <TableHead>Name</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Detail</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {results.map((r) => (
                    <TableRow key={r.row.excelRow}>
                      <TableCell className="text-xs">{r.row.excelRow}</TableCell>
                      <TableCell className="text-xs">{r.row.name}</TableCell>
                      <TableCell className="text-xs">{r.status}</TableCell>
                      <TableCell className="text-xs">{r.error ?? r.row.warnings.join("; ")}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </Card>
          </div>
        )}

        <DialogFooter>
          {rows && !results && (
            <>
              <Button variant="outline" onClick={reset} disabled={importing}>Choose different file</Button>
              <Button
                onClick={onConfirm}
                disabled={importing || !rows.some((r) => r.errors.length === 0)}
              >
                {importing ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Importing…</> :
                  `Import ${rows.filter((r) => r.errors.length === 0).length} draft job(s)`}
              </Button>
            </>
          )}
          {results && (
            <Button onClick={() => handleClose(false)}>Done</Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
