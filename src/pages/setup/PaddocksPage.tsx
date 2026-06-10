import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import ListPage, { type ListColumn } from "@/pages/setup/ListPage";
import PaddockMapView from "@/components/PaddockMapView";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { deriveMetrics } from "@/lib/paddockGeometry";
import { Button } from "@/components/ui/button";
import { Plus, ChevronDown, Wrench } from "lucide-react";
import { useVineyard } from "@/context/VineyardContext";
import PaddockImportExportDialog from "@/components/paddocks/PaddockImportExportDialog";
import PaddockBoundaryImportDialog from "@/components/paddocks/PaddockBoundaryImportDialog";
import PaddockBoundaryExportDialog from "@/components/paddocks/PaddockBoundaryExportDialog";
import PaddockFullBlockBackupDialog from "@/components/paddocks/PaddockFullBlockBackupDialog";
import ArchivedPaddocksSection from "@/components/paddocks/ArchivedPaddocksSection";
import { useRegionFormatters } from "@/lib/useRegionFormatters";

const fmtNum = (n: number, digits = 1) =>
  Number.isFinite(n) ? n.toLocaleString(undefined, { maximumFractionDigits: digits }) : "—";

export default function PaddocksPage() {
  const [tab, setTab] = useState("table");
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const { currentRole } = useVineyard();
  const canEdit = currentRole === "owner" || currentRole === "manager";
  const rf = useRegionFormatters();
  const paddockCols: ListColumn[] = useMemo(
    () => [
      { key: "name", label: "Name", render: (r) => r.name ?? "—" },
      {
        key: "area",
        label: "Area",
        render: (r) => {
          const m = deriveMetrics(r);
          return m.areaHa > 0 ? rf.area(m.areaHa, 2) : "—";
        },
        filterValue: (r) => String(deriveMetrics(r).areaHa.toFixed(2)),
      },
      {
        key: "rows",
        label: "Rows",
        render: (r) => fmtNum(deriveMetrics(r).rowCount, 0),
        filterValue: (r) => String(deriveMetrics(r).rowCount),
      },
      {
        key: "row_length",
        label: "Total row length (m)",
        render: (r) => {
          const m = deriveMetrics(r);
          return m.totalRowLengthM > 0 ? fmtNum(m.totalRowLengthM, 0) : "—";
        },
        filterValue: (r) => String(Math.round(deriveMetrics(r).totalRowLengthM)),
      },
      { key: "vine_spacing", label: "Vine spacing (m)" },
      { key: "intermediate_post_spacing", label: "Int. post spacing (m)" },
      { key: "updated_at", label: "Updated" },
    ],
    [rf],
  );
  return (
    <Tabs value={tab} onValueChange={setTab} className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        <TabsList>
          <TabsTrigger value="table">Table</TabsTrigger>
          <TabsTrigger value="map">Map</TabsTrigger>
        </TabsList>
        <div className="flex items-center gap-2">
          <PaddockFullBlockBackupDialog />
          {canEdit && (
            <Button asChild size="sm" className="gap-1">
              <Link to="/setup/paddocks/new">
                <Plus className="h-4 w-4" /> New block
              </Link>
            </Button>
          )}
        </div>
      </div>
      <TabsContent value="table" className="mt-0">
        <ListPage
          table="paddocks"
          title="Blocks"
          columns={paddockCols}
          basePath="/setup/paddocks"
        />
        <div className="mt-4">
          <ArchivedPaddocksSection />
        </div>
        <Collapsible
          open={advancedOpen}
          onOpenChange={setAdvancedOpen}
          className="mt-6 rounded-lg border bg-muted/20"
        >
          <CollapsibleTrigger asChild>
            <button
              type="button"
              className="flex w-full items-center justify-between gap-2 px-4 py-3 text-left"
            >
              <span className="flex items-center gap-2 text-sm font-medium">
                <Wrench className="h-4 w-4" />
                Advanced GIS &amp; Spreadsheet Tools
              </span>
              <ChevronDown
                className={`h-4 w-4 transition-transform ${
                  advancedOpen ? "rotate-180" : ""
                }`}
              />
            </button>
          </CollapsibleTrigger>
          <CollapsibleContent className="space-y-3 border-t px-4 py-3">
            <p className="text-xs text-muted-foreground">
              These partial tools are kept for advanced GIS or spreadsheet
              workflows. They do <b>not</b> include full block setup. For
              backup, restore or migration, use{" "}
              <b>Full Block Backup &amp; Restore</b> above.
            </p>
            <div>
              <div className="mb-1 text-xs font-semibold uppercase text-muted-foreground">
                Spreadsheet CSV (setup fields only)
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <PaddockImportExportDialog />
                <span className="text-xs text-muted-foreground">
                  Does not include boundaries, rows or variety allocations.
                </span>
              </div>
            </div>
            <div>
              <div className="mb-1 text-xs font-semibold uppercase text-muted-foreground">
                Boundaries only (KML / GeoJSON)
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <PaddockBoundaryExportDialog />
                <PaddockBoundaryImportDialog />
                <span className="text-xs text-muted-foreground">
                  Polygon geometry only. Does not include rows, varieties, vine
                  spacing, emitter spacing or block setup.
                </span>
              </div>
            </div>
          </CollapsibleContent>
        </Collapsible>
      </TabsContent>
      <TabsContent value="map" className="mt-0">
        <PaddockMapView />
      </TabsContent>
    </Tabs>
  );
}

