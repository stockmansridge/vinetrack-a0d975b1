// Soil Analysis — customer-facing landing page (Resources). Access is the
// normal RequireVineyard + role route matrix; backend RLS is vineyard-scoped.
// Tabs: Overview | Soil Samples | Trends | Compare | Traffic Lights | Reports.
import { useNavigate, useSearchParams } from "react-router-dom";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { AdminPageHeader } from "./_shared";
import { OverviewTab } from "@/components/soil-analysis/OverviewTab";
import { SamplesTab } from "@/components/soil-analysis/SamplesTab";
import { TrendsTab } from "@/components/soil-analysis/TrendsTab";
import { CompareTab } from "@/components/soil-analysis/CompareTab";
import { ReportsTab } from "@/components/soil-analysis/ReportsTab";
import SoilAnalysisHelpDialog from "@/components/soil-analysis/SoilAnalysisHelpDialog";
import { TrafficLightsTab } from "@/components/soil-analysis/TrafficLightsTab";

const TABS = ["overview", "samples", "trends", "compare", "traffic-lights", "reports"] as const;
type SoilTab = (typeof TABS)[number];

export default function SoilAnalysisPage() {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const raw = params.get("tab") ?? "overview";
  const tab: SoilTab = (TABS as readonly string[]).includes(raw) ? (raw as SoilTab) : "overview";

  const openSample = (id: string) => navigate(`/soil-analysis/samples/${id}`);

  return (
    <div className="p-4 md:p-6 w-full max-w-none min-w-0">
      <div className="w-full max-w-none">
        <AdminPageHeader
          title="Soil Analysis"
          subtitle="Laboratory soil reports, block mapping and trends"
          back="/dashboard"
          titleExtra={<SoilAnalysisHelpDialog />}
        />

      </div>

      <Tabs className="w-full max-w-none min-w-0" value={tab} onValueChange={(v) => setParams({ tab: v }, { replace: true })}>
        <div className="w-full max-w-none">
          <TabsList className="max-w-full flex-wrap justify-start">
            <TabsTrigger value="overview">Overview</TabsTrigger>
            <TabsTrigger value="samples">Soil Samples</TabsTrigger>
            <TabsTrigger value="trends">Trends</TabsTrigger>
            <TabsTrigger value="compare">Compare</TabsTrigger>
            <TabsTrigger value="traffic-lights">Traffic Lights</TabsTrigger>
            <TabsTrigger value="reports">Map</TabsTrigger>
          </TabsList>
        </div>
        <TabsContent value="overview" className="mt-4 w-full max-w-none min-w-0">
          <OverviewTab onOpenSample={openSample} />
        </TabsContent>
        <TabsContent value="samples" className="mt-4 w-full max-w-none min-w-0">
          <SamplesTab onOpenSample={openSample} />
        </TabsContent>
        <TabsContent value="trends" className="mt-4 w-full max-w-none min-w-0">
          <TrendsTab />
        </TabsContent>
        <TabsContent value="compare" className="mt-4 w-full max-w-none min-w-0">
          <CompareTab />
        </TabsContent>
        <TabsContent value="reports" className="mt-4 w-full max-w-none min-w-0">
          <ReportsTab onOpenSample={openSample} />
        </TabsContent>
        <TabsContent value="traffic-lights" className="mt-4 w-full max-w-none min-w-0">
          <TrafficLightsTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}
