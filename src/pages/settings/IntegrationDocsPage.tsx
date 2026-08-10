// Stage 4 — Portal-hosted documentation for the live, read-only VineTrack API.
// No real API keys are ever shown here; examples use the <VT_API_KEY> placeholder.
import { Link } from "react-router-dom";
import { ArrowLeft, Check, Copy } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PortalNotice } from "@/components/ui/PortalNotice";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { IOS_SUPABASE_URL } from "@/integrations/ios-supabase/client";
import { SCOPE_LABELS } from "@/lib/integrationsQuery";

const API_BASE_URL = `${IOS_SUPABASE_URL}/functions/v1/vinetrack-api/v1`;

const RESOURCES: { group: string; items: { path: string; scope: string; description: string }[] }[] = [
  {
    group: "Core",
    items: [
      { path: "/vineyards", scope: "vineyards:read", description: "Vineyards granted to the integration." },
      { path: "/blocks", scope: "blocks:read", description: "Block/paddock structure and row layout." },
    ],
  },
  {
    group: "Operations",
    items: [
      { path: "/trips", scope: "trips:read", description: "Operational trip records." },
      { path: "/spray-jobs", scope: "sprays:read", description: "Completed/applied spray records." },
      { path: "/fuel-records", scope: "fuel:read", description: "Fuel usage records." },
      { path: "/fuel-purchases", scope: "fuel:read", description: "Fuel purchases (monetary fields require costs:read)." },
      { path: "/equipment", scope: "equipment:read", description: "Tractors, spray equipment and other assets." },
      { path: "/work-tasks", scope: "work_tasks:read", description: "Work tasks." },
      { path: "/pruning", scope: "pruning:read", description: "Pruning activity and season progress." },
      { path: "/irrigation-records", scope: "irrigation:read", description: "Irrigation records." },
      { path: "/growth-stages", scope: "growth_stages:read", description: "Growth stage observations." },
      { path: "/yield-records", scope: "yield:read", description: "Yield records." },
      { path: "/pins", scope: "pins:read", description: "Observation pins with canonical placement." },
    ],
  },
  {
    group: "Environment",
    items: [
      { path: "/weather", scope: "weather:read", description: "Weather observations for granted vineyards." },
      { path: "/rainfall", scope: "rainfall:read", description: "Rainfall records." },
      { path: "/disease-risk", scope: "disease_risk:read", description: "Disease risk assessments." },
    ],
  },
];

const SCOPE_DESCRIPTIONS: Record<string, string> = {
  "vineyards:read": "Read vineyard metadata for granted vineyards.",
  "blocks:read": "Read block/paddock structure and row layout.",
  "trips:read": "Read tractor and operational trip records for granted vineyards.",
  "sprays:read": "Read completed/applied spray records for granted vineyards.",
  "fuel:read": "Read fuel usage and purchase records. Monetary fields additionally require Costs access.",
  "equipment:read": "Read equipment and asset records.",
  "work_tasks:read": "Read work tasks for granted vineyards.",
  "pruning:read": "Read pruning activities and season progress.",
  "irrigation:read": "Read irrigation records.",
  "growth_stages:read": "Read growth stage observations.",
  "yield:read": "Read yield records.",
  "pins:read": "Read observation pins and their canonical placement.",
  "weather:read": "Read weather data for granted vineyards.",
  "rainfall:read": "Read rainfall data for granted vineyards.",
  "disease_risk:read": "Read disease risk assessments.",
  "labour:read": "Unlock approved operator/worker identity fields on resources already granted.",
  "costs:read": "Unlock approved monetary fields on resources already granted.",
  "team:read": "Reserved for future team-level integration access.",
};

function CodeBlock({ label, code }: { label: string; code: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          {label}
        </span>
        <Button
          variant="ghost"
          size="sm"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(code);
              setCopied(true);
              setTimeout(() => setCopied(false), 2000);
            } catch {
              /* clipboard unavailable */
            }
          }}
        >
          {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
        </Button>
      </div>
      <pre className="overflow-x-auto rounded-lg border bg-muted/40 p-3 text-xs">
        <code>{code}</code>
      </pre>
    </div>
  );
}

export default function IntegrationDocsPage() {
  return (
    <div className="space-y-6 p-4 md:p-8">
      <div className="space-y-3">
        <Button variant="ghost" size="sm" asChild className="-ml-2 w-fit">
          <Link to="/settings/integrations">
            <ArrowLeft className="mr-2 h-4 w-4" />
            Integrations &amp; API
          </Link>
        </Button>
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">VineTrack API documentation</h1>
          <p className="max-w-2xl text-sm text-muted-foreground">
            The VineTrack external API is read-only. Requests are authenticated with
            an integration API key and scoped to the vineyards and permissions
            granted to that integration.
          </p>
        </div>
      </div>

      <PortalNotice
        variant="info"
        title="Read-only API"
        description="Only GET requests are supported. POST, PUT, PATCH and DELETE are not available."
      />

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Base URL &amp; version</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <div>
            <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
              Base URL
            </div>
            <code className="break-all font-mono text-sm">{API_BASE_URL}</code>
          </div>
          <p className="text-muted-foreground">
            The API is versioned in the path. The current version is{" "}
            <Badge variant="outline">v1</Badge>.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Authentication</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <p className="text-muted-foreground">
            Send your integration API key as a bearer token. Keys begin with{" "}
            <code className="font-mono">vt_live_</code> and are shown once at
            creation.
          </p>
          <CodeBlock label="Header" code={`Authorization: Bearer <VT_API_KEY>`} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Examples</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <CodeBlock
            label="curl"
            code={`curl \\
  -H "Authorization: Bearer <VT_API_KEY>" \\
  "${API_BASE_URL}/vineyards"`}
          />
          <CodeBlock
            label="JavaScript (fetch)"
            code={`const res = await fetch("${API_BASE_URL}/vineyards", {
  headers: { Authorization: \`Bearer \${process.env.VT_API_KEY}\` },
});
const data = await res.json();`}
          />
          <CodeBlock
            label="PowerShell"
            code={`Invoke-RestMethod -Uri "${API_BASE_URL}/vineyards" \`
  -Headers @{ Authorization = "Bearer $env:VT_API_KEY" }`}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Pagination, errors &amp; rate limiting</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm text-muted-foreground">
          <p>
            <span className="font-medium text-foreground">Pagination.</span> List
            endpoints accept <code className="font-mono">limit</code> and{" "}
            <code className="font-mono">offset</code> query parameters and return
            paging metadata alongside the result set.
          </p>
          <p>
            <span className="font-medium text-foreground">Errors.</span> Errors use
            standard HTTP status codes with a machine-readable error code:{" "}
            <code className="font-mono">401</code> authentication failed,{" "}
            <code className="font-mono">403</code> missing scope or vineyard grant,{" "}
            <code className="font-mono">404</code> unknown resource,{" "}
            <code className="font-mono">429</code> rate limited,{" "}
            <code className="font-mono">5xx</code> server error.
          </p>
          <p>
            <span className="font-medium text-foreground">Rate limiting.</span>{" "}
            Requests are rate limited per API key. When the limit is exceeded the
            API responds with <code className="font-mono">429</code>; retry after a
            short delay.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Resources</CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          {RESOURCES.map((group) => (
            <div key={group.group} className="space-y-2">
              <h3 className="text-sm font-semibold">{group.group}</h3>
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Endpoint</TableHead>
                      <TableHead>Required scope</TableHead>
                      <TableHead>Description</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {group.items.map((item) => (
                      <TableRow key={item.path}>
                        <TableCell>
                          <code className="font-mono text-xs">GET /v1{item.path}</code>
                        </TableCell>
                        <TableCell>
                          <code className="font-mono text-xs">{item.scope}</code>
                        </TableCell>
                        <TableCell className="text-muted-foreground">
                          {item.description}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Scopes</CardTitle>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Scope</TableHead>
                <TableHead>Permission</TableHead>
                <TableHead>Description</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {Object.keys(SCOPE_LABELS).map((scope) => (
                <TableRow key={scope}>
                  <TableCell>
                    <code className="font-mono text-xs">{scope}</code>
                  </TableCell>
                  <TableCell>{SCOPE_LABELS[scope]}</TableCell>
                  <TableCell className="text-muted-foreground">
                    {SCOPE_DESCRIPTIONS[scope] ?? "—"}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
