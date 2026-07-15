import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/ios-supabase/client";
import { useVineyard } from "@/context/VineyardContext";
import { canSeeCosts } from "@/lib/permissions";
import { toast } from "@/hooks/use-toast";
import { PageHead } from "@/components/PageHead";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { FlaskConical, Plus, Trash2, Copy, Pencil, Download } from "lucide-react";
import { ALL_STATUSES, STATUS_LABEL, type FertiliserRecordStatus } from "@/lib/fertiliserCalc";
import {
  fetchFertiliserRecords,
  softDeleteFertiliserRecord,
  type FertiliserRecord,
} from "@/lib/fertiliserRecordsQuery";
import FertiliserCalculatorDialog, { paddocksToOptions } from "@/components/fertiliser/FertiliserCalculatorDialog";
import { formatDate } from "@/lib/dateFormat";

function usePaddocks(vineyardId: string | null) {
  return useQuery({
    queryKey: ["fertiliser", "paddocks", vineyardId],
    enabled: !!vineyardId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("paddocks")
        .select(
          "id, name, rows, polygon_points, vine_spacing, vine_count_override, row_length_override, row_length_overrides",
        )
        .eq("vineyard_id", vineyardId!)
        .is("deleted_at", null)
        .order("name", { ascending: true });
      if (error) throw error;
      return data ?? [];
    },
  });
}

function useRecords(vineyardId: string | null) {
  return useQuery({
    queryKey: ["fertiliser", "records", vineyardId],
    enabled: !!vineyardId,
    queryFn: () => fetchFertiliserRecords(vineyardId!),
  });
}

function statusBadge(s: string) {
  switch (s) {
    case "completed":
      return <Badge className="bg-emerald-600 hover:bg-emerald-600">Completed</Badge>;
    case "planned":
      return <Badge variant="secondary">Planned</Badge>;
    case "draft":
      return <Badge variant="outline">Draft</Badge>;
    case "cancelled":
      return <Badge variant="destructive">Cancelled</Badge>;
    default:
      return <Badge variant="outline">{s}</Badge>;
  }
}

function toCsv(records: FertiliserRecord[]): string {
  const cols = [
    "application_date",
    "product_name",
    "form",
    "calculation_mode",
    "record_status",
    "block_names",
    "total_area_ha",
    "total_vines",
    "application_rate",
    "application_rate_unit",
    "total_product_required",
    "product_unit",
    "pack_size",
    "pack_count",
    "estimated_product_cost",
    "labour_cost",
    "machinery_cost",
    "total_job_cost",
    "notes",
  ];
  const esc = (v: any) => {
    if (v == null) return "";
    const s = Array.isArray(v) ? v.join("; ") : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [cols.join(",")];
  for (const r of records) {
    lines.push(cols.map((c) => esc((r as any)[c])).join(","));
  }
  return lines.join("\n");
}

export default function FertiliserCalculatorPage() {
  const { selectedVineyardId, memberships, currentRole } = useVineyard();
  const vineyard = memberships.find((m) => m.vineyard_id === selectedVineyardId);
  const qc = useQueryClient();
  const showCosts = canSeeCosts(currentRole);

  const paddocksQ = usePaddocks(selectedVineyardId);
  const recordsQ = useRecords(selectedVineyardId);

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<FertiliserRecord | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<FertiliserRecord | null>(null);
  const [statusFilter, setStatusFilter] = useState<FertiliserRecordStatus | "all">("all");
  const [search, setSearch] = useState("");

  const paddockOptions = useMemo(
    () => paddocksToOptions((paddocksQ.data ?? []) as any[]),
    [paddocksQ.data],
  );

  const filteredRecords = useMemo(() => {
    const list = recordsQ.data ?? [];
    const q = search.trim().toLowerCase();
    return list.filter((r) => {
      if (statusFilter !== "all" && r.record_status !== statusFilter) return false;
      if (!q) return true;
      const hay = `${r.product_name} ${(r.block_names ?? []).join(" ")}`.toLowerCase();
      return hay.includes(q);
    });
  }, [recordsQ.data, statusFilter, search]);

  const deleteMut = useMutation({
    mutationFn: (id: string) => softDeleteFertiliserRecord(id),
    onSuccess: () => {
      toast({ title: "Record removed" });
      qc.invalidateQueries({ queryKey: ["fertiliser", "records", selectedVineyardId] });
      setConfirmDelete(null);
    },
    onError: (err: any) =>
      toast({
        title: "Could not delete",
        description: String(err?.message ?? err ?? ""),
        variant: "destructive",
      }),
  });

  const onDuplicate = (r: FertiliserRecord) => {
    // Clone as a fresh Draft. The dialog generates a new id + new
    // allocation ids because `existing` is null.
    const clone: FertiliserRecord = {
      ...r,
      id: crypto.randomUUID(),
      record_status: "draft",
      sync_version: 0,
      created_at: "",
      updated_at: "",
    };
    // We pass it as `existing` so the form pre-fills — but with the new id.
    setEditing(clone);
    setDialogOpen(true);
  };

  const onExportCsv = () => {
    const csv = toCsv(filteredRecords);
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `fertiliser-records-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  const canWrite =
    !!currentRole && ["owner", "manager", "supervisor", "operator"].includes(currentRole);

  return (
    <div className="p-4 sm:p-6 max-w-6xl mx-auto">
      <PageHead
        title="Fertiliser Calculator"
        description="Calculate fertiliser applications and record costs."
        path="/tools/fertiliser-calculator"
      />

      <div className="flex items-start justify-between gap-3 mb-6 flex-wrap">
        <div className="flex items-center gap-3">
          <div className="rounded-lg bg-primary/10 p-2 text-primary">
            <FlaskConical className="h-6 w-6" />
          </div>
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Fertiliser Calculator</h1>
            <p className="text-sm text-muted-foreground">
              {vineyard?.vineyard_name
                ? `Vineyard: ${vineyard.vineyard_name}`
                : "No vineyard selected"}
            </p>
          </div>
        </div>
        <div className="flex gap-2 flex-wrap">
          <Button asChild variant="outline" size="sm">
            <Link to="/setup/chemicals">Manage saved products</Link>
          </Button>
          <Button variant="outline" size="sm" onClick={onExportCsv} disabled={filteredRecords.length === 0}>
            <Download className="h-4 w-4 mr-1" /> CSV
          </Button>
          {canWrite && (
            <Button
              size="sm"
              onClick={() => {
                setEditing(null);
                setDialogOpen(true);
              }}
              disabled={paddockOptions.length === 0}
            >
              <Plus className="h-4 w-4 mr-1" /> New calculation
            </Button>
          )}
        </div>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Records</CardTitle>
          <CardDescription>
            All fertiliser calculations for this vineyard, live-synced with iOS and Android.
          </CardDescription>
          <div className="flex gap-2 flex-wrap pt-2">
            <Input
              className="max-w-xs"
              placeholder="Search product or block…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as any)}>
              <SelectTrigger className="w-40">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All statuses</SelectItem>
                {ALL_STATUSES.map((s) => (
                  <SelectItem key={s} value={s}>
                    {STATUS_LABEL[s]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardHeader>
        <CardContent>
          {recordsQ.isLoading && (
            <div className="text-sm text-muted-foreground">Loading records…</div>
          )}
          {!recordsQ.isLoading && filteredRecords.length === 0 && (
            <div className="text-sm text-muted-foreground p-6 text-center border rounded">
              {recordsQ.data?.length === 0
                ? "No fertiliser records yet."
                : "No records match the current filters."}
            </div>
          )}
          {filteredRecords.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-xs uppercase text-muted-foreground">
                  <tr>
                    <th className="text-left py-2 pr-3">Date</th>
                    <th className="text-left py-2 pr-3">Product</th>
                    <th className="text-left py-2 pr-3">Blocks</th>
                    <th className="text-right py-2 pr-3">Rate</th>
                    <th className="text-right py-2 pr-3">Total</th>
                    {showCosts && <th className="text-right py-2 pr-3">Job cost</th>}
                    <th className="text-left py-2 pr-3">Status</th>
                    <th className="text-right py-2">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {filteredRecords.map((r) => (
                    <tr key={r.id} className="hover:bg-accent/30">
                      <td className="py-2 pr-3 tabular-nums whitespace-nowrap">
                        {formatDate(r.application_date)}
                      </td>
                      <td className="py-2 pr-3">
                        <div className="font-medium">{r.product_name || "—"}</div>
                        <div className="text-xs text-muted-foreground">
                          {r.form} · {r.calculation_mode === "perVine" ? "Per vine" : "Per hectare"}
                        </div>
                      </td>
                      <td className="py-2 pr-3 max-w-[220px]">
                        <div className="truncate" title={(r.block_names ?? []).join(", ")}>
                          {(r.block_names ?? []).join(", ") || "—"}
                        </div>
                      </td>
                      <td className="py-2 pr-3 text-right tabular-nums whitespace-nowrap">
                        {r.application_rate} {r.application_rate_unit}
                      </td>
                      <td className="py-2 pr-3 text-right tabular-nums whitespace-nowrap">
                        {r.total_product_required} {r.product_unit}
                      </td>
                      {showCosts && (
                        <td className="py-2 pr-3 text-right tabular-nums whitespace-nowrap">
                          {r.total_job_cost == null ? "—" : `$${Number(r.total_job_cost).toFixed(2)}`}
                        </td>
                      )}
                      <td className="py-2 pr-3">{statusBadge(r.record_status)}</td>
                      <td className="py-2 text-right whitespace-nowrap">
                        <Button
                          variant="ghost"
                          size="icon"
                          title="Edit"
                          disabled={!canWrite}
                          onClick={() => {
                            setEditing(r);
                            setDialogOpen(true);
                          }}
                        >
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          title="Duplicate as Draft"
                          disabled={!canWrite}
                          onClick={() => onDuplicate(r)}
                        >
                          <Copy className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          title="Delete"
                          disabled={!canWrite}
                          onClick={() => setConfirmDelete(r)}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {selectedVineyardId && dialogOpen && (
        <FertiliserCalculatorDialog
          open={dialogOpen}
          onOpenChange={(v) => {
            setDialogOpen(v);
            if (!v) setEditing(null);
          }}
          vineyardId={selectedVineyardId}
          paddocks={paddockOptions}
          role={currentRole}
          existing={editing}
        />
      )}

      <AlertDialog open={!!confirmDelete} onOpenChange={(v) => !v && setConfirmDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove this fertiliser record?</AlertDialogTitle>
            <AlertDialogDescription>
              The record is soft-deleted so it can be restored by a manager if needed. Any linked Work Task is not removed.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => confirmDelete && deleteMut.mutate(confirmDelete.id)}
              disabled={deleteMut.isPending}
            >
              {deleteMut.isPending ? "Removing…" : "Remove"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
