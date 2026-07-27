import { useState } from "react";
import { Link } from "react-router-dom";
import { useVineyard } from "@/context/VineyardContext";
import { useVintage } from "@/lib/useVintage";
import { PageHead } from "@/components/PageHead";
import { PortalNotice } from "@/components/ui/PortalNotice";
import { Button } from "@/components/ui/button";
import { MetricCard } from "@/components/ui/metric-card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { BarChart3, Download, Droplet, Gauge, Timer } from "lucide-react";
import { formatDate } from "@/lib/dateFormat";
import {
  formatDuration,
  formatLitres,
  formatNumber,
  useBlockSummary,
  useDailySummary,
  useMonthlySummary,
  useValveSummary,
  useVarietySummary,
  useVintageSummary,
} from "@/lib/irrigationQuery";

function downloadCsv(name: string, headers: string[], rows: (string | number | null)[][]) {
  const escape = (v: string | number | null) =>
    v == null ? "" : `"${String(v).replace(/"/g, '""')}"`;
  const csv = [headers, ...rows].map((r) => r.map(escape).join(",")).join("\n");
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8;" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

function ExportButton({ onClick }: { onClick: () => void }) {
  return (
    <Button size="sm" variant="outline" onClick={onClick}>
      <Download className="mr-1.5 h-4 w-4" /> Export CSV
    </Button>
  );
}

function Empty({ label }: { label: string }) {
  return <div className="px-1 py-6 text-sm text-muted-foreground">{label}</div>;
}

export default function IrrigationReportsPage() {
  const { selectedVineyardId } = useVineyard();
  const { vintage } = useVintage();
  const [year, setYear] = useState<number | null>(null);
  const vintageYear = year ?? vintage;

  const summary = useVintageSummary(selectedVineyardId, vintageYear);
  const valves = useValveSummary(selectedVineyardId, vintageYear);
  const blocks = useBlockSummary(selectedVineyardId, vintageYear);
  const varieties = useVarietySummary(selectedVineyardId, vintageYear);
  const daily = useDailySummary(selectedVineyardId, vintageYear);
  const monthly = useMonthlySummary(selectedVineyardId, vintageYear);

  const years = [vintage, vintage - 1, vintage - 2];

  return (
    <div className="space-y-6">
      <PageHead
        title="Irrigation Reports | VineTrack"
        description="Water applied by vintage, valve, block, variety, day and month for your vineyard."
        path="/reports/irrigation"
        noindex
      />

      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Irrigation Reports</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Vintage {vintageYear} · aggregated from saved irrigation sessions.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {years.map((y) => (
            <Button
              key={y}
              size="sm"
              variant={y === vintageYear ? "default" : "outline"}
              onClick={() => setYear(y)}
            >
              {y}
            </Button>
          ))}
          <Button asChild size="sm" variant="ghost">
            <Link to="/irrigation">Irrigation Records</Link>
          </Button>
        </div>
      </header>

      {summary.error && (
        <PortalNotice
          variant="error"
          title="Couldn't load irrigation reports"
          description={(summary.error as Error).message}
        />
      )}

      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard
          label="Water applied"
          value={formatLitres(summary.data?.total_volume_litres)}
          icon={Droplet}
          tone="teal"
          hint={`${summary.data?.session_count ?? 0} sessions`}
        />
        <MetricCard
          label="Runtime"
          value={formatDuration(summary.data?.total_runtime_minutes)}
          icon={Timer}
          tone="primary"
          hint={`Average ${formatDuration(summary.data?.average_session_minutes ?? null)} per session`}
        />
        <MetricCard
          label="Water per vine"
          value={
            summary.data?.water_litres_per_vine != null
              ? `${formatNumber(summary.data.water_litres_per_vine, 2)} L`
              : "—"
          }
          icon={Gauge}
          tone="purple"
        />
        <MetricCard
          label="Irrigation depth"
          value={
            summary.data?.irrigation_depth_mm != null
              ? `${formatNumber(summary.data.irrigation_depth_mm, 2)} mm`
              : "—"
          }
          icon={BarChart3}
          tone="accent"
        />
      </section>

      <Tabs defaultValue="valve">
        <TabsList className="flex-wrap">
          <TabsTrigger value="valve">By valve</TabsTrigger>
          <TabsTrigger value="block">By block</TabsTrigger>
          <TabsTrigger value="variety">By variety</TabsTrigger>
          <TabsTrigger value="daily">Daily</TabsTrigger>
          <TabsTrigger value="monthly">Monthly</TabsTrigger>
        </TabsList>

        <TabsContent value="valve" className="mt-4">
          <Card>
            <CardHeader className="flex-row items-center justify-between space-y-0">
              <div>
                <CardTitle className="text-base">Water by valve</CardTitle>
                <CardDescription>Volume, runtime and last irrigation per valve.</CardDescription>
              </div>
              <ExportButton
                onClick={() =>
                  downloadCsv(
                    `irrigation-valves-${vintageYear}.csv`,
                    ["Valve", "System", "Volume (L)", "Runtime (min)", "Sessions", "Last irrigation"],
                    (valves.data ?? []).map((r) => [
                      r.valve_name,
                      r.system_name,
                      r.total_volume_litres,
                      r.total_runtime_minutes,
                      r.session_count,
                      r.last_irrigation_date,
                    ]),
                  )
                }
              />
            </CardHeader>
            <CardContent className="pt-0">
              {valves.data?.length === 0 ? (
                <Empty label="No irrigation recorded for this vintage." />
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Valve</TableHead>
                      <TableHead>System</TableHead>
                      <TableHead className="text-right">Water</TableHead>
                      <TableHead className="text-right">Runtime</TableHead>
                      <TableHead className="text-right">Sessions</TableHead>
                      <TableHead>Last irrigation</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {valves.data?.map((r) => (
                      <TableRow key={r.valve_id}>
                        <TableCell className="font-medium">{r.valve_name}</TableCell>
                        <TableCell>{r.system_name}</TableCell>
                        <TableCell className="text-right tabular-nums">
                          {formatLitres(r.total_volume_litres)}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {formatDuration(r.total_runtime_minutes)}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">{r.session_count}</TableCell>
                        <TableCell>
                          {r.last_irrigation_date ? formatDate(r.last_irrigation_date) : "—"}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="block" className="mt-4">
          <Card>
            <CardHeader className="flex-row items-center justify-between space-y-0">
              <div>
                <CardTitle className="text-base">Water by block</CardTitle>
                <CardDescription>Allocated water, per-vine and depth per block.</CardDescription>
              </div>
              <ExportButton
                onClick={() =>
                  downloadCsv(
                    `irrigation-blocks-${vintageYear}.csv`,
                    ["Block", "Volume (L)", "Effective (L)", "Sessions", "L/vine", "L/ha", "Depth (mm)", "Last irrigation"],
                    (blocks.data ?? []).map((r) => [
                      r.block_name,
                      r.total_volume_litres,
                      r.effective_volume_litres,
                      r.session_count,
                      r.water_litres_per_vine,
                      r.water_litres_per_hectare,
                      r.irrigation_depth_mm,
                      r.last_irrigation_date,
                    ]),
                  )
                }
              />
            </CardHeader>
            <CardContent className="pt-0">
              {blocks.data?.length === 0 ? (
                <Empty label="No block-level irrigation for this vintage." />
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Block</TableHead>
                      <TableHead className="text-right">Water</TableHead>
                      <TableHead className="text-right">L / vine</TableHead>
                      <TableHead className="text-right">L / ha</TableHead>
                      <TableHead className="text-right">Depth</TableHead>
                      <TableHead className="text-right">Sessions</TableHead>
                      <TableHead>Last irrigation</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {blocks.data?.map((r) => (
                      <TableRow key={r.block_id}>
                        <TableCell className="font-medium">{r.block_name}</TableCell>
                        <TableCell className="text-right tabular-nums">
                          {formatLitres(r.total_volume_litres)}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {formatNumber(r.water_litres_per_vine, 2)}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {formatNumber(r.water_litres_per_hectare, 0)}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {r.irrigation_depth_mm != null
                            ? `${formatNumber(r.irrigation_depth_mm, 2)} mm`
                            : "—"}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">{r.session_count}</TableCell>
                        <TableCell>
                          {r.last_irrigation_date ? formatDate(r.last_irrigation_date) : "—"}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="variety" className="mt-4">
          <Card>
            <CardHeader className="flex-row items-center justify-between space-y-0">
              <div>
                <CardTitle className="text-base">Water by variety</CardTitle>
                <CardDescription>
                  Weighted per-vine and per-hectare water for each variety.
                </CardDescription>
              </div>
              <ExportButton
                onClick={() =>
                  downloadCsv(
                    `irrigation-varieties-${vintageYear}.csv`,
                    ["Variety", "Volume (L)", "Serviced area (m2)", "Serviced vines", "L/ha", "L/vine", "Depth (mm)"],
                    (varieties.data ?? []).map((r) => [
                      r.variety_name,
                      r.total_volume_litres,
                      r.total_serviced_area_m2,
                      r.total_serviced_vines,
                      r.average_water_litres_per_hectare,
                      r.average_water_litres_per_vine,
                      r.irrigation_depth_mm,
                    ]),
                  )
                }
              />
            </CardHeader>
            <CardContent className="pt-0">
              {varieties.data?.length === 0 ? (
                <Empty label="No variety-level irrigation for this vintage." />
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Variety</TableHead>
                      <TableHead className="text-right">Water</TableHead>
                      <TableHead className="text-right">L / vine</TableHead>
                      <TableHead className="text-right">L / ha</TableHead>
                      <TableHead className="text-right">Depth</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {varieties.data?.map((r) => (
                      <TableRow key={r.variety_name}>
                        <TableCell className="font-medium">{r.variety_name}</TableCell>
                        <TableCell className="text-right tabular-nums">
                          {formatLitres(r.total_volume_litres)}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {formatNumber(r.average_water_litres_per_vine, 2)}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {formatNumber(r.average_water_litres_per_hectare, 0)}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {r.irrigation_depth_mm != null
                            ? `${formatNumber(r.irrigation_depth_mm, 2)} mm`
                            : "—"}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="daily" className="mt-4">
          <Card>
            <CardHeader className="flex-row items-center justify-between space-y-0">
              <div>
                <CardTitle className="text-base">Daily water use</CardTitle>
                <CardDescription>Volume and runtime for each irrigation day.</CardDescription>
              </div>
              <ExportButton
                onClick={() =>
                  downloadCsv(
                    `irrigation-daily-${vintageYear}.csv`,
                    ["Date", "Volume (L)", "Runtime (min)", "Sessions"],
                    (daily.data ?? []).map((r) => [
                      r.date,
                      r.total_volume_litres,
                      r.runtime_minutes,
                      r.session_count,
                    ]),
                  )
                }
              />
            </CardHeader>
            <CardContent className="pt-0">
              {daily.data?.length === 0 ? (
                <Empty label="No irrigation days recorded for this vintage." />
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Date</TableHead>
                      <TableHead className="text-right">Water</TableHead>
                      <TableHead className="text-right">Runtime</TableHead>
                      <TableHead className="text-right">Sessions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {daily.data?.map((r) => (
                      <TableRow key={r.date}>
                        <TableCell>{formatDate(r.date)}</TableCell>
                        <TableCell className="text-right tabular-nums">
                          {formatLitres(r.total_volume_litres)}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {formatDuration(r.runtime_minutes)}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">{r.session_count}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="monthly" className="mt-4">
          <Card>
            <CardHeader className="flex-row items-center justify-between space-y-0">
              <div>
                <CardTitle className="text-base">Monthly water use</CardTitle>
                <CardDescription>Volume, runtime and weighted depth by month.</CardDescription>
              </div>
              <ExportButton
                onClick={() =>
                  downloadCsv(
                    `irrigation-monthly-${vintageYear}.csv`,
                    ["Month", "Volume (L)", "Runtime (min)", "Sessions", "Depth (mm)"],
                    (monthly.data ?? []).map((r) => [
                      r.month,
                      r.total_volume_litres,
                      r.runtime_minutes,
                      r.session_count,
                      r.irrigation_depth_mm,
                    ]),
                  )
                }
              />
            </CardHeader>
            <CardContent className="pt-0">
              {monthly.data?.length === 0 ? (
                <Empty label="No monthly irrigation for this vintage." />
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Month</TableHead>
                      <TableHead className="text-right">Water</TableHead>
                      <TableHead className="text-right">Runtime</TableHead>
                      <TableHead className="text-right">Depth</TableHead>
                      <TableHead className="text-right">Sessions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {monthly.data?.map((r) => (
                      <TableRow key={r.month}>
                        <TableCell>
                          {new Date(r.month).toLocaleDateString(undefined, {
                            month: "long",
                            year: "numeric",
                          })}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {formatLitres(r.total_volume_litres)}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {formatDuration(r.runtime_minutes)}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {r.irrigation_depth_mm != null
                            ? `${formatNumber(r.irrigation_depth_mm, 2)} mm`
                            : "—"}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">{r.session_count}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
