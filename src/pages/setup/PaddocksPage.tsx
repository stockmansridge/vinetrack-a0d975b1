import { useState } from "react";
import ListPage from "@/pages/setup/ListPage";
import PaddockMapView from "@/components/PaddockMapView";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";

const paddockCols = [
  { key: "name", label: "Name" },
  { key: "planting_year", label: "Planted" },
  { key: "row_width", label: "Row width (m)" },
  { key: "vine_spacing", label: "Vine spacing (m)" },
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
