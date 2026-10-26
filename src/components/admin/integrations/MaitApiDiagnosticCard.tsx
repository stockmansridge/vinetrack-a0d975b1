// System Admin diagnostic: one-click check that the live VineTrack MAIT
// Edge Function can authenticate against MAIT Industries' documented public
// trial network (iNTELLiWeb /getdata v2.21) and parse the module list.
//
// Read-only by contract: it only calls the existing maitProxy(..., 'test')
// action. It never saves credentials, never sets a weather module, never
// changes the observation provider and never writes observations, rainfall
// or irrigation sessions. The trial password is published by MAIT for
// testing; it is a constant here and is never rendered, logged or included
// in error output.
import { useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { CheckCircle2, XCircle, AlertTriangle, Satellite } from "lucide-react";
import { useVineyard } from "@/context/VineyardContext";
import { maitProxy, maitModules, type MaitResult } from "@/lib/maitIntelliwebQuery";
import { formatDateTime } from "@/lib/dateFormat";

// MAIT's published public trial account (iNTELLiWeb /getdata v2.21 docs).
const TRIAL_NETWORK_ID = "1001";
const TRIAL_USERNAME = "getdata";
const TRIAL_PASSWORD = "trial"; // published by MAIT; never rendered or logged

export type MaitTrialOverall = "PASS" | "FAIL" | "PARTIAL";

export interface MaitTrialReport {
  overall: MaitTrialOverall;
  testedAt: Date;
  edgeReachable: boolean | null;
  maitAuthAccepted: boolean | null;
  networkId: string;
  networkName: string | null;
  modules: { id: string; name: string }[];
  module52Detected: boolean;
  statusLine: string;
  message: string;
}

/** Classify a successful (non-throwing) maitProxy 'test' response. */
export function classifyMaitTrialSuccess(result: MaitResult, testedAt: Date): MaitTrialReport {
  const modules = maitModules(result.data).map((m) => ({ id: m.id, name: m.name }));
  const networkName =
    (result.data?.network_name as string | undefined) ??
    (result.data?.network?.name as string | undefined) ??
    null;
  const base: MaitTrialReport = {
    overall: "PASS",
    testedAt,
    edgeReachable: true,
    maitAuthAccepted: true,
    networkId: String(result.data?.network_id ?? TRIAL_NETWORK_ID),
    networkName,
    modules,
    module52Detected: modules.some((m) => m.id === "52"),
    statusLine: `HTTP ${result.status}`,
    message: "Live MAIT trial network responded as expected.",
  };
  if (result.empty || result.status === 204 || modules.length === 0) {
    return {
      ...base,
      overall: "FAIL",
      message: "MAIT accepted the request but returned no module data.",
    };
  }
  if (result.partial || result.status === 206) {
    return {
      ...base,
      overall: "PARTIAL",
      message:
        "MAIT truncated the response (HTTP 206). The module list may be incomplete, so this is not a full pass.",
    };
  }
  return base;
}

/** Classify a thrown maitProxy error into a customer-safe diagnostic. */
export function classifyMaitTrialError(error: unknown, testedAt: Date): MaitTrialReport {
  const raw = error instanceof Error ? error.message : String(error);
  const base: MaitTrialReport = {
    overall: "FAIL",
    testedAt,
    edgeReachable: true,
    maitAuthAccepted: null,
    networkId: TRIAL_NETWORK_ID,
    networkName: null,
    modules: [],
    module52Detected: false,
    statusLine: "Error",
    message: raw || "The MAIT trial test could not be completed.",
  };
  // MAIT upstream 401 (typed proxy envelope) — distinct from a VineTrack
  // session-expired 401, which says nothing about MAIT authentication.
  if (/MAIT authentication failed/i.test(raw)) {
    return {
      ...base,
      maitAuthAccepted: false,
      statusLine: "HTTP 401",
      message: "MAIT authentication failed — the documented trial credentials were not accepted.",
    };
  }
  if (/session has expired/i.test(raw)) {
    return {
      ...base,
      statusLine: "HTTP 401",
      message: "Your VineTrack session has expired. Sign in again before running the MAIT diagnostic.",
    };
  }
  // MAIT upstream 204 surfaces from the live proxy as HTTP 404 mait_no_data.
  if (/MAIT returned no data/i.test(raw)) {
    return {
      ...base,
      maitAuthAccepted: true,
      statusLine: "HTTP 404",
      message: "MAIT accepted the request but returned no module data.",
    };
  }
  if (/MAIT rejected the request format|could not accept this request/i.test(raw)) {
    return {
      ...base,
      statusLine: "HTTP 400",
      message: "MAIT rejected the request format.",
    };
  }
  if (/do not have permission/i.test(raw)) {
    return {
      ...base,
      statusLine: "HTTP 403",
      message:
        "The signed-in account or selected vineyard context is not authorised to run this diagnostic.",
    };
  }
  if (/could not be reached/i.test(raw)) {
    return {
      ...base,
      edgeReachable: false,
      statusLine: "Network",
      message:
        "The VineTrack MAIT proxy could not be reached. This is a VineTrack-side network failure, not a MAIT response.",
    };
  }
  if (/unreadable response/i.test(raw)) {
    return {
      ...base,
      statusLine: "Upstream",
      message: "MAIT returned an unreadable response. This points to a MAIT upstream failure.",
    };
  }
  return {
    ...base,
    statusLine: "Upstream",
    message: `The VineTrack proxy or MAIT upstream failed: ${raw}`,
  };
}

const OVERALL_STYLES: Record<MaitTrialOverall, string> = {
  PASS: "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  FAIL: "border-destructive/40 bg-destructive/10 text-destructive",
  PARTIAL: "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300",
};

function YesNo({ value }: { value: boolean | null }) {
  if (value === null) return <span className="text-muted-foreground">Unknown</span>;
  return value ? <span>Yes</span> : <span>No</span>;
}

function TrialResultPanel({ report }: { report: MaitTrialReport }) {
  const Icon =
    report.overall === "PASS" ? CheckCircle2 : report.overall === "PARTIAL" ? AlertTriangle : XCircle;
  return (
    <div className="mt-3 rounded-md border p-3 text-sm space-y-3" data-testid="mait-trial-result">
      <div className="flex flex-wrap items-center gap-2">
        <Icon className="h-4 w-4 shrink-0" />
        <Badge variant="outline" className={OVERALL_STYLES[report.overall]}>
          {report.overall}
        </Badge>
        <span className="text-xs text-muted-foreground">
          Tested at {formatDateTime(report.testedAt.toISOString())}
        </span>
      </div>

      <dl className="grid grid-cols-1 gap-x-6 gap-y-1 text-xs sm:grid-cols-2">
        <div className="flex justify-between gap-2">
          <dt className="text-muted-foreground">VineTrack Edge Function reachable</dt>
          <dd><YesNo value={report.edgeReachable} /></dd>
        </div>
        <div className="flex justify-between gap-2">
          <dt className="text-muted-foreground">MAIT authentication accepted</dt>
          <dd><YesNo value={report.maitAuthAccepted} /></dd>
        </div>
        <div className="flex justify-between gap-2">
          <dt className="text-muted-foreground">Network ID</dt>
          <dd className="font-mono">{report.networkId}</dd>
        </div>
        <div className="flex justify-between gap-2">
          <dt className="text-muted-foreground">Network name</dt>
          <dd>{report.networkName ?? "—"}</dd>
        </div>
        <div className="flex justify-between gap-2">
          <dt className="text-muted-foreground">Modules returned</dt>
          <dd>{report.modules.length}</dd>
        </div>
        <div className="flex justify-between gap-2">
          <dt className="text-muted-foreground">Response status</dt>
          <dd className="font-mono">{report.statusLine}</dd>
        </div>
      </dl>

      <p className="text-xs">{report.message}</p>

      {report.module52Detected && (
        <p className="text-xs text-emerald-700 dark:text-emerald-300">
          Documented sample module 52 detected (informational — MAIT may change its trial data).
        </p>
      )}

      {report.modules.length > 0 && (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-24">Module ID</TableHead>
              <TableHead>Description</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {report.modules.map((m) => (
              <TableRow key={m.id}>
                <TableCell className="font-mono">{m.id}</TableCell>
                <TableCell>{m.name || "—"}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
}

export function MaitApiDiagnosticCard() {
  const { selectedVineyardId } = useVineyard();
  const [running, setRunning] = useState(false);
  const [report, setReport] = useState<MaitTrialReport | null>(null);

  const disabled = running || !selectedVineyardId;

  const run = async () => {
    if (!selectedVineyardId || running) return;
    setRunning(true);
    setReport(null);
    const testedAt = new Date();
    try {
      const result = await maitProxy(selectedVineyardId, "test", {
        username: TRIAL_USERNAME,
        password: TRIAL_PASSWORD,
        networkId: TRIAL_NETWORK_ID,
      });
      setReport(classifyMaitTrialSuccess(result, testedAt));
    } catch (err) {
      setReport(classifyMaitTrialError(err, testedAt));
    } finally {
      setRunning(false);
    }
  };

  return (
    <Card className="p-5">
      <div className="mb-3 flex items-start gap-2">
        <Satellite className="h-4 w-4 mt-0.5 text-primary" />
        <div>
          <h3 className="font-semibold">MAIT iNTELLiWeb API</h3>
          <p className="text-xs text-muted-foreground mt-1">
            Tests VineTrack's live MAIT integration against MAIT Industries' public trial network.
            No vineyard configuration or customer credentials are changed.
          </p>
        </div>
      </div>
      <Button onClick={run} disabled={disabled}>
        {running ? "Running…" : "Run MAIT trial test"}
      </Button>
      {!selectedVineyardId && (
        <p className="text-xs text-muted-foreground mt-2">
          Select a vineyard to provide the authenticated test context.
        </p>
      )}
      {report && <TrialResultPanel report={report} />}
    </Card>
  );
}

export default MaitApiDiagnosticCard;
