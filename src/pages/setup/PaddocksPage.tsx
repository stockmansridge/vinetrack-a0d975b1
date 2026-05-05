import { useState } from "react";
import { Link } from "react-router-dom";
import ListPage, { type ListColumn } from "@/pages/setup/ListPage";
import PaddockMapView from "@/components/PaddockMapView";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { deriveMetrics } from "@/lib/paddockGeometry";
import { Button } from "@/components/ui/button";
import { Plus } from "lucide-react";
import { useVineyard } from "@/context/VineyardContext";

const fmtNum = (n: number, digits = 1) =>
  Number.isFinite(n) ? n.toLocaleString(undefined, { maximumFractionDigits: digits }) : "—";

const paddockCols: ListColumn[] = [
  { key: "name", label: "Name", render: (r) => r.name ?? "—" },
  {
    key: "area_ha",
    label: "Area (ha)",
    render: (r) => {
      const m = deriveMetrics(r);
      return m.areaHa > 0 ? fmtNum(m.areaHa, 2) : "—";
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
];

export default function PaddocksPage() {
  const [tab, setTab] = useState("table");
  return (
    <Tabs value={tab} onValueChange={setTab} className="space-y-4">
      <TabsList>
        <TabsTrigger value="table">Table</TabsTrigger>
        <TabsTrigger value="map">Map</TabsTrigger>
      </TabsList>
      <TabsContent value="table" className="mt-0">
        <ListPage
          table="paddocks"
          title="Paddocks"
          columns={paddockCols}
          basePath="/setup/paddocks"
        />
      </TabsContent>
      <TabsContent value="map" className="mt-0">
        <PaddockMapView />
      </TabsContent>
    </Tabs>
  );
}
