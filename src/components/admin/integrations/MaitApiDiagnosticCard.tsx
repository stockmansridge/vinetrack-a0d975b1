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

// ---- Full data diagnostic (trial_deep_test) ----
// The backend owns the published trial credentials for this deeper test; the
// browser sends NO username/password/network/module/date arguments.
export interface MaitDeepCheck {
  key: string;
  status: "pass" | "fail" | "info";
  message: string;
}

export interface MaitDeepReport {
  overall: MaitTrialOverall;
  testedAt: Date;
  statusLine: string;
  readOnly: boolean;
  writesPerformed: number;
  networkId: string;
  networkName: string | null;
  modulesReturned: number;
  module52Present: boolean;
  module: {
    moduleId: string;
    moduleName: string | null;
    recordCount: number | null;
    latestDatetime: string | null;
    columns: {
      channelKey: string;
      channelNumber: number | null;
      label: string | null;
      unit: string | null;
      latestValue: string | null;
    }[];
  } | null;
  usage: {
    startDate: string | null;
    endDate: string | null;
    outputs: {
      channelNumber: number | null;
      channelName: string | null;
      hasDuration: boolean;
      hasVolume: boolean;
      durationKey: string | null;
      volumeKey: string | null;
    }[];
    events: {
      datetimeRaw: string;
      channelNumber: number | null;
      channelName: string | null;
      durationMinutes: number | null;
      durationSource: string | null;
      volumeKl: number | null;
      volumeLitres: number | null;
      volumeSource: string | null;
    }[];
  } | null;
  checks: MaitDeepCheck[];
  errorMessage: string | null;
}

/** Classify a successful (non-throwing) trial_deep_test response. The
 *  backend's `overall` is authoritative — the frontend never recomputes it,
 *  except that HTTP 206 always surfaces as PARTIAL (truncated MAIT data). */
export function classifyMaitDeepSuccess(result: MaitResult, testedAt: Date): MaitDeepReport {
  const d = (result.data ?? {}) as Record<string, any>;
  const network = (d.network ?? {}) as Record<string, any>;
  const mod = (d.module ?? null) as Record<string, any> | null;
  const usage = (d.usage ?? null) as Record<string, any> | null;
  const backendOverall = String(d.overall ?? "fail").toLowerCase();
  const overall: MaitTrialOverall =
    result.partial || result.status === 206
      ? "PARTIAL"
      : backendOverall === "pass"
        ? "PASS"
        : backendOverall === "partial"
          ? "PARTIAL"
          : "FAIL";
  return {
    overall,
    testedAt,
    statusLine: `HTTP ${result.status}`,
    readOnly: d.read_only !== false,
    writesPerformed: Number(d.writes_performed ?? 0),
    networkId: String(network.network_id ?? TRIAL_NETWORK_ID),
    networkName: (network.network_name as string | undefined) ?? null,
    modulesReturned: Number(network.modules_returned ?? 0),
    module52Present: Boolean(network.module_52_present),
    module: mod
      ? {
          moduleId: String(mod.module_id ?? "52"),
          moduleName: (mod.module_name as string | undefined) ?? null,
          recordCount: mod.record_count == null ? null : Number(mod.record_count),
          latestDatetime: (mod.latest_datetime as string | undefined) ?? null,
          columns: (Array.isArray(mod.columns) ? mod.columns : []).map((c: any) => ({
            channelKey: String(c.channel_key ?? ""),
            channelNumber: c.channel_number == null ? null : Number(c.channel_number),
            label: (c.label as string | undefined) ?? null,
            unit: (c.unit as string | undefined) ?? null,
            latestValue: c.latest_value == null ? null : String(c.latest_value),
          })),
        }
      : null,
    usage: usage
      ? {
          startDate: (usage.start_date as string | undefined) ?? null,
          endDate: (usage.end_date as string | undefined) ?? null,
          outputs: (Array.isArray(usage.outputs) ? usage.outputs : []).map((o: any) => ({
            channelNumber: o.channel_number == null ? null : Number(o.channel_number),
            channelName: (o.channel_name as string | undefined) ?? null,
            hasDuration: Boolean(o.has_duration),
            hasVolume: Boolean(o.has_volume),
            durationKey: (o.duration_key as string | undefined) ?? null,
            volumeKey: (o.volume_key as string | undefined) ?? null,
          })),
          events: (Array.isArray(usage.events) ? usage.events : []).map((e: any) => ({
            datetimeRaw: String(e.datetime_raw ?? ""),
            channelNumber: e.channel_number == null ? null : Number(e.channel_number),
            channelName: (e.channel_name as string | undefined) ?? null,
            durationMinutes: e.duration_minutes == null ? null : Number(e.duration_minutes),
            durationSource: (e.duration_source as string | undefined) ?? null,
            volumeKl: e.volume_kl == null ? null : Number(e.volume_kl),
            volumeLitres: e.volume_litres == null ? null : Number(e.volume_litres),
            volumeSource: (e.volume_source as string | undefined) ?? null,
          })),
        }
      : null,
    checks: (Array.isArray(d.checks) ? d.checks : []).map((c: any) => ({
      key: String(c.key ?? ""),
      status: c.status === "pass" ? "pass" : c.status === "info" ? "info" : "fail",
      message: String(c.message ?? ""),
    })),
    errorMessage:
      result.partial || result.status === 206
        ? "MAIT truncated the response (HTTP 206). The test returned partial MAIT data."
        : null,
  };
}

/** Reuse the basic trial error classifier for the deep test — the same typed
 *  MAIT errors apply (auth/session/permission/network). */
export function classifyMaitDeepError(error: unknown, testedAt: Date): MaitDeepReport {
  const basic = classifyMaitTrialError(error, testedAt);
  return {
    overall: basic.overall,
    testedAt,
    statusLine: basic.statusLine,
    readOnly: true,
    writesPerformed: 0,
    networkId: basic.networkId,
    networkName: basic.networkName,
    modulesReturned: 0,
    module52Present: false,
    module: null,
    usage: null,
    checks: [],
    errorMessage: basic.message,
  };
}

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

const CHECK_STYLES: Record<MaitDeepCheck["status"], string> = {
  pass: "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  fail: "border-destructive/40 bg-destructive/10 text-destructive",
  info: "border-border bg-muted text-muted-foreground",
};

function CheckBadge({ status }: { status: MaitDeepCheck["status"] }) {
  return (
    <Badge variant="outline" className={CHECK_STYLES[status]}>
      {status === "pass" ? "Pass" : status === "info" ? "Info" : "Fail"}
    </Badge>
  );
}

function DeepResultPanel({ report }: { report: MaitDeepReport }) {
  const Icon =
    report.overall === "PASS" ? CheckCircle2 : report.overall === "PARTIAL" ? AlertTriangle : XCircle;
  return (
    <div
      className="mt-4 rounded-md border p-3 text-sm space-y-4"
      data-testid="mait-deep-result"
    >
      <h4 className="font-semibold text-sm">Full data diagnostic</h4>

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
          <dt className="text-muted-foreground">Read-only</dt>
          <dd>{report.readOnly ? "Yes" : "No"}</dd>
        </div>
        <div className="flex justify-between gap-2">
          <dt className="text-muted-foreground">Writes performed</dt>
          <dd>{report.writesPerformed}</dd>
        </div>
        <div className="flex justify-between gap-2">
          <dt className="text-muted-foreground">Network</dt>
          <dd>
            {report.networkName ?? "—"} <span className="font-mono">({report.networkId})</span>
          </dd>
        </div>
        <div className="flex justify-between gap-2">
          <dt className="text-muted-foreground">Modules returned</dt>
          <dd>{report.modulesReturned}</dd>
        </div>
        <div className="flex justify-between gap-2">
          <dt className="text-muted-foreground">Module 52 present</dt>
          <dd><YesNo value={report.module52Present} /></dd>
        </div>
        <div className="flex justify-between gap-2">
          <dt className="text-muted-foreground">Response status</dt>
          <dd className="font-mono">{report.statusLine}</dd>
        </div>
      </dl>

      {report.errorMessage && <p className="text-xs">{report.errorMessage}</p>}

      {report.module && (
        <section className="space-y-2">
          <h5 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Module 52 — current data parser
          </h5>
          <dl className="grid grid-cols-1 gap-x-6 gap-y-1 text-xs sm:grid-cols-3">
            <div className="flex justify-between gap-2">
              <dt className="text-muted-foreground">Module name</dt>
              <dd>{report.module.moduleName ?? "—"}</dd>
            </div>
            <div className="flex justify-between gap-2">
              <dt className="text-muted-foreground">Latest DateTime</dt>
              <dd className="font-mono">{report.module.latestDatetime ?? "—"}</dd>
            </div>
            <div className="flex justify-between gap-2">
              <dt className="text-muted-foreground">Record count</dt>
              <dd>{report.module.recordCount ?? "—"}</dd>
            </div>
          </dl>
          {report.module.columns.length > 0 && (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-20">Channel</TableHead>
                  <TableHead>MAIT label</TableHead>
                  <TableHead className="w-20">Unit</TableHead>
                  <TableHead className="w-28">Latest value</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {report.module.columns.map((c) => (
                  <TableRow key={c.channelKey}>
                    <TableCell className="font-mono">{c.channelNumber ?? c.channelKey}</TableCell>
                    <TableCell>{c.label ?? "—"}</TableCell>
                    <TableCell>{c.unit ?? "—"}</TableCell>
                    <TableCell className="font-mono">{c.latestValue ?? "—"}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </section>
      )}

      {report.usage && (
        <section className="space-y-2">
          <h5 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Module 52 — irrigation usage parser
          </h5>
          <dl className="grid grid-cols-1 gap-x-6 gap-y-1 text-xs sm:grid-cols-2">
            <div className="flex justify-between gap-2">
              <dt className="text-muted-foreground">Test range</dt>
              <dd className="font-mono">
                {report.usage.startDate ?? "—"} → {report.usage.endDate ?? "—"}
              </dd>
            </div>
            <div className="flex justify-between gap-2">
              <dt className="text-muted-foreground">Outputs detected</dt>
              <dd>{report.usage.outputs.length}</dd>
            </div>
          </dl>
          {report.usage.outputs.length > 0 && (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-20">Output</TableHead>
                  <TableHead>Name</TableHead>
                  <TableHead className="w-28">Duration channel</TableHead>
                  <TableHead className="w-28">Volume channel</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {report.usage.outputs.map((o, i) => (
                  <TableRow key={`${o.channelNumber ?? "x"}-${i}`}>
                    <TableCell className="font-mono">{o.channelNumber ?? "—"}</TableCell>
                    <TableCell>{o.channelName ?? "—"}</TableCell>
                    <TableCell className="font-mono">
                      {o.hasDuration ? (o.durationKey ?? "Yes") : "—"}
                    </TableCell>
                    <TableCell className="font-mono">
                      {o.hasVolume ? (o.volumeKey ?? "Yes") : "—"}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
          {report.usage.events.length > 0 && (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date/time</TableHead>
                  <TableHead className="w-24">Output</TableHead>
                  <TableHead className="w-24">Duration (min)</TableHead>
                  <TableHead className="w-24">Volume (kL)</TableHead>
                  <TableHead className="w-24">Volume (L)</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {report.usage.events.map((e, i) => (
                  <TableRow key={`${e.datetimeRaw}-${i}`}>
                    <TableCell className="font-mono">{e.datetimeRaw || "—"}</TableCell>
                    <TableCell>{e.channelName ?? e.channelNumber ?? "—"}</TableCell>
                    <TableCell className="font-mono">{e.durationMinutes ?? "—"}</TableCell>
                    <TableCell className="font-mono">{e.volumeKl ?? "—"}</TableCell>
                    <TableCell className="font-mono">{e.volumeLitres ?? "—"}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </section>
      )}

      {report.checks.length > 0 && (
        <section className="space-y-2">
          <h5 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Parser checks
          </h5>
          <ul className="space-y-1">
            {report.checks.map((c) => (
              <li key={c.key} className="flex items-start gap-2 text-xs">
                <CheckBadge status={c.status} />
                <span>
                  <span className="font-mono text-muted-foreground">{c.key}</span> — {c.message}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
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
  const [deepRunning, setDeepRunning] = useState(false);
  const [deepReport, setDeepReport] = useState<MaitDeepReport | null>(null);

  const disabled = running || deepRunning || !selectedVineyardId;

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

  // Full data diagnostic: the backend owns the published trial credentials —
  // the browser sends no username/password/network/module/date arguments.
  const runDeep = async () => {
    if (!selectedVineyardId || deepRunning) return;
    setDeepRunning(true);
    setDeepReport(null);
    const testedAt = new Date();
    try {
      const result = await maitProxy(selectedVineyardId, "trial_deep_test", {});
      setDeepReport(classifyMaitDeepSuccess(result, testedAt));
    } catch (err) {
      setDeepReport(classifyMaitDeepError(err, testedAt));
    } finally {
      setDeepRunning(false);
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
      <div className="flex flex-wrap gap-2">
        <Button onClick={run} disabled={disabled}>
          {running ? "Running…" : "Run MAIT trial test"}
        </Button>
        <Button variant="outline" onClick={runDeep} disabled={disabled}>
          {deepRunning ? "Running…" : "Run full MAIT data test"}
        </Button>
      </div>
      {!selectedVineyardId && (
        <p className="text-xs text-muted-foreground mt-2">
          Select a vineyard to provide the authenticated test context.
        </p>
      )}
      {report && <TrialResultPanel report={report} />}
      {deepReport && <DeepResultPanel report={deepReport} />}
    </Card>
  );
}

export default MaitApiDiagnosticCard;
