// Soil Analysis — customer-facing landing page (Resources). Access is the
// normal RequireVineyard + role route matrix; backend RLS is vineyard-scoped.
// Tabs: Overview | Soil Samples | Trends | Compare | Reports.
import { useNavigate, useSearchParams } from "react-router-dom";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { AdminPageHeader } from "./_shared";
import { OverviewTab } from "@/components/soil-analysis/OverviewTab";
import { SamplesTab } from "@/components/soil-analysis/SamplesTab";
import { TrendsTab } from "@/components/soil-analysis/TrendsTab";
import { CompareTab } from "@/components/soil-analysis/CompareTab";
import { ReportsTab } from "@/components/soil-analysis/ReportsTab";
import SoilAnalysisHelpDialog from "@/components/soil-analysis/SoilAnalysisHelpDialog";

const TABS = ["overview", "samples", "trends", "compare", "reports"] as const;
type SoilTab = (typeof TABS)[number];

export default function SoilAnalysisPage() {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const raw = params.get("tab") ?? "overview";
  const tab: SoilTab = (TABS as readonly string[]).includes(raw) ? (raw as SoilTab) : "overview";

  const openSample = (id: string) => navigate(`/soil-analysis/samples/${id}`);

  return (
    // Reports uses the full Portal workspace width; the header, banner, tab
    // strip and the other tabs keep the comfortable max-w-6xl column.
    <div className="p-4 md:p-6 w-full max-w-none">
      <div className="max-w-6xl">
        <AdminPageHeader
          title="Soil Analysis"
          subtitle="Laboratory soil reports, block mapping and trends"
        />
      </div>

      <Tabs value={tab} onValueChange={(v) => setParams({ tab: v }, { replace: true })}>
        <div className="max-w-6xl">
          <TabsList>
            <TabsTrigger value="overview">Overview</TabsTrigger>
            <TabsTrigger value="samples">Soil Samples</TabsTrigger>
            <TabsTrigger value="trends">Trends</TabsTrigger>
            <TabsTrigger value="compare">Compare</TabsTrigger>
            <TabsTrigger value="reports">Reports</TabsTrigger>
          </TabsList>
        </div>
        <TabsContent value="overview" className="mt-4 max-w-6xl">
          <OverviewTab onOpenSample={openSample} />
        </TabsContent>
        <TabsContent value="samples" className="mt-4 max-w-6xl">
          <SamplesTab onOpenSample={openSample} />
        </TabsContent>
        <TabsContent value="trends" className="mt-4 max-w-6xl">
          <TrendsTab />
        </TabsContent>
        <TabsContent value="compare" className="mt-4 max-w-6xl">
          <CompareTab />
        </TabsContent>
        <TabsContent value="reports" className="mt-4 w-full max-w-none">
          <ReportsTab onOpenSample={openSample} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
