// Stage 6B — Portal-hosted developer documentation & onboarding.
//
// Every route, event and scope on this page is derived at build time from the
// canonical Stage 6A assets (see src/lib/developerDocs.ts). Nothing is
// hand-maintained here and no API key or secret is ever displayed — examples
// use the <VT_API_KEY> placeholder only.
import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowLeft, Check, Copy, Download, FileJson, FileText } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
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
import { scopeLabel, SENSITIVE_SCOPE_NOTES } from "@/lib/integrationsQuery";
import { DocsMarkdown } from "@/components/integrations/DocsMarkdown";
import {
  API_INFO,
  API_ROUTE_COUNT,
  API_ROUTES,
  CHANGELOG_MD,
  DEVELOPER_GUIDE_MD,
  DOC_SCOPES,
  OPENAPI_FILENAME,
  OPENAPI_YAML,
  POSTMAN_COLLECTION,
  POSTMAN_FILENAME,
  SCOPE_COUNT,
  WEBHOOK_EVENTS,
  WEBHOOK_EVENTS_EMITTED,
  WEBHOOK_EVENT_COUNT,
  WEBHOOK_GUIDE_MD,
  downloadTextFile,
  groupRoutesByTag,
  sectionsByHeadingPrefix,
} from "@/lib/developerDocs";

const API_BASE_URL = `${IOS_SUPABASE_URL}/functions/v1/vinetrack-api/v1`;

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

function StatTile({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-lg border bg-card p-3">
      <div className="text-xl font-semibold tracking-tight">{value}</div>
      <div className="text-xs text-muted-foreground">{label}</div>
    </div>
  );
}

export default function IntegrationDocsPage() {
  const [routeFilter, setRouteFilter] = useState("");
  const [eventFilter, setEventFilter] = useState("");

  const gettingStarted = useMemo(
    () =>
      sectionsByHeadingPrefix(DEVELOPER_GUIDE_MD, [
        "1.",
        "2.",
        "3.",
        "23.",
      ]),
    [],
  );

  const referenceSections = useMemo(
    () =>
      sectionsByHeadingPrefix(DEVELOPER_GUIDE_MD, [
        "7.",
        "8.",
        "9.",
        "10.",
        "18.",
      ]),
    [],
  );

  const webhookSections = useMemo(
    () =>
      sectionsByHeadingPrefix(DEVELOPER_GUIDE_MD, [
        "11.",
        "12.",
        "14.",
        "15.",
        "16.",
        "17.",
      ]),
    [],
  );

  const webhookDeepSections = useMemo(
    () =>
      sectionsByHeadingPrefix(WEBHOOK_GUIDE_MD, [
        "Delivery model",
        "Prerequisites",
        "Endpoint URL policy",
        "Security properties",
        "Retention and limitations",
      ]),
    [],
  );

  const scopeSection = useMemo(
    () => sectionsByHeadingPrefix(DEVELOPER_GUIDE_MD, ["4."]),
    [],
  );

  const filteredRouteGroups = useMemo(() => {
    const q = routeFilter.trim().toLowerCase();
    const routes = q
      ? API_ROUTES.filter(
          (r) =>
            r.path.toLowerCase().includes(q) ||
            r.summary.toLowerCase().includes(q) ||
            r.tag.toLowerCase().includes(q) ||
            (r.scope ?? "").toLowerCase().includes(q),
        )
      : API_ROUTES;
    return groupRoutesByTag(routes);
  }, [routeFilter]);

  const filteredEvents = useMemo(() => {
    const q = eventFilter.trim().toLowerCase();
    if (!q) return WEBHOOK_EVENTS;
    return WEBHOOK_EVENTS.filter(
      (e) =>
        e.event.toLowerCase().includes(q) ||
        e.resource_type.toLowerCase().includes(q) ||
        (e.required_scope ?? "").toLowerCase().includes(q) ||
        e.description.toLowerCase().includes(q),
    );
  }, [eventFilter]);

  return (
    <div className="space-y-6 p-4 md:p-8">
      <div className="space-y-3">
        <Button variant="ghost" size="sm" asChild className="-ml-2 w-fit">
          <Link to="/settings/integrations">
            <ArrowLeft className="mr-2 h-4 w-4" />
            Integrations &amp; API
          </Link>
        </Button>
        <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
          <div className="space-y-1">
            <h1 className="text-2xl font-semibold tracking-tight">
              VineTrack developer platform
            </h1>
            <p className="max-w-2xl text-sm text-muted-foreground">
              Onboarding, REST API reference, webhook events and change history for
              the VineTrack {API_INFO.version} integration platform. Reads cover the
              whole catalogue; writes are limited to the resources explicitly enabled
              for each integration and scoped to its granted vineyards.
            </p>

          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              onClick={() =>
                downloadTextFile(OPENAPI_FILENAME, OPENAPI_YAML, "application/yaml")
              }
            >
              <Download className="mr-2 h-4 w-4" />
              OpenAPI 3.1 (YAML)
            </Button>
            <Button
              variant="outline"
              title="Download the Postman collection"
              onClick={() =>
                downloadTextFile(
                  POSTMAN_FILENAME,
                  POSTMAN_COLLECTION,
                  "application/json",
                )
              }
            >
              <FileJson className="mr-2 h-4 w-4" />
              Postman collection
            </Button>
          </div>
        </div>
      </div>

      <PortalNotice
        variant="info"
        title="Reads are open, writes are controlled"
        description="Every resource is readable with a GET. Controlled external writes (POST / PATCH) are available for Work Tasks, Fuel, Irrigation, Growth Stages and Yield only, require an explicitly granted write permission, and enforce idempotency on create and optimistic concurrency on update."
      />


      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile label="API routes" value={API_ROUTE_COUNT} />
        <StatTile
          label={`Webhook events (${WEBHOOK_EVENTS_EMITTED} emitted in v1)`}
          value={WEBHOOK_EVENT_COUNT}
        />
        <StatTile label="Scopes" value={SCOPE_COUNT} />
        <StatTile label="API version" value={API_INFO.version} />
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Base URL &amp; authentication</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4 text-sm">
          <div>
            <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
              Base URL
            </div>
            <code className="break-all font-mono text-sm">{API_BASE_URL}</code>
          </div>
          <p className="text-muted-foreground">
            The API is versioned in the path. The current version is{" "}
            <Badge variant="outline">{API_INFO.version}</Badge>. Send your
            integration API key as a bearer token — keys begin with{" "}
            <code className="font-mono">vt_live_</code> or{" "}
            <code className="font-mono">vt_test_</code> and are shown once at
            creation.
          </p>
          <CodeBlock label="Header" code={`Authorization: Bearer <VT_API_KEY>`} />
          <CodeBlock
            label="curl"
            code={`curl \\
  -H "Authorization: Bearer <VT_API_KEY>" \\
  "${API_BASE_URL}/me"`}
          />
          <CodeBlock
            label="JavaScript (fetch)"
            code={`const res = await fetch("${API_BASE_URL}/vineyards", {
  headers: { Authorization: \`Bearer \${process.env.VT_API_KEY}\` },
});
const data = await res.json();`}
          />
        </CardContent>
      </Card>

      <Tabs defaultValue="start" className="space-y-4">
        <TabsList className="flex h-auto flex-wrap justify-start">
          <TabsTrigger value="start">Getting started</TabsTrigger>
          <TabsTrigger value="api">API reference</TabsTrigger>
          <TabsTrigger value="webhooks">Webhooks</TabsTrigger>
          <TabsTrigger value="scopes">Scopes</TabsTrigger>
          <TabsTrigger value="changelog">Changelog</TabsTrigger>
        </TabsList>

        {/* Getting started ------------------------------------------------ */}
        <TabsContent value="start" className="space-y-4">
          {gettingStarted.map((section) => (
            <Card key={section.heading}>
              <CardHeader>
                <CardTitle className="text-base">{section.heading}</CardTitle>
              </CardHeader>
              <CardContent>
                <DocsMarkdown>{section.body}</DocsMarkdown>
              </CardContent>
            </Card>
          ))}
        </TabsContent>

        {/* API reference --------------------------------------------------- */}
        <TabsContent value="api" className="space-y-4">
          <Card>
            <CardHeader className="gap-3 sm:flex-row sm:items-center sm:justify-between">
              <CardTitle className="text-base">
                REST catalogue
                <span className="ml-2 text-xs font-normal text-muted-foreground">
                  {API_ROUTE_COUNT} routes
                </span>
              </CardTitle>
              <Input
                value={routeFilter}
                onChange={(e) => setRouteFilter(e.target.value)}
                placeholder="Filter routes, scopes or tags…"
                className="sm:max-w-xs"
              />
            </CardHeader>
            <CardContent className="space-y-6">
              {filteredRouteGroups.length === 0 && (
                <p className="text-sm text-muted-foreground">No routes match that filter.</p>
              )}
              {filteredRouteGroups.map((group) => (
                <div key={group.tag} className="space-y-2">
                  <h3 className="text-sm font-semibold">{group.tag}</h3>
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
                        {group.routes.map((route) => (
                          <TableRow key={`${route.method} ${route.path}`}>
                            <TableCell className="whitespace-nowrap">
                              <code className="font-mono text-xs">
                                {route.method} {route.path}
                              </code>
                            </TableCell>
                            <TableCell>
                              {route.scope ? (
                                <code className="font-mono text-xs">{route.scope}</code>
                              ) : (
                                <span className="text-xs text-muted-foreground">
                                  No resource scope
                                </span>
                              )}
                            </TableCell>
                            <TableCell className="text-muted-foreground">
                              <div>{route.summary}</div>
                              {route.description && (
                                <div className="text-xs">{route.description}</div>
                              )}
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

          {referenceSections.map((section) => (
            <Card key={section.heading}>
              <CardHeader>
                <CardTitle className="text-base">{section.heading}</CardTitle>
              </CardHeader>
              <CardContent>
                <DocsMarkdown>{section.body}</DocsMarkdown>
              </CardContent>
            </Card>
          ))}
        </TabsContent>

        {/* Webhooks -------------------------------------------------------- */}
        <TabsContent value="webhooks" className="space-y-4">
          <Card>
            <CardHeader className="gap-3 sm:flex-row sm:items-center sm:justify-between">
              <CardTitle className="text-base">
                Event catalogue
                <span className="ml-2 text-xs font-normal text-muted-foreground">
                  {WEBHOOK_EVENT_COUNT} events · {WEBHOOK_EVENTS_EMITTED} emitted in v1
                </span>
              </CardTitle>
              <Input
                value={eventFilter}
                onChange={(e) => setEventFilter(e.target.value)}
                placeholder="Filter events…"
                className="sm:max-w-xs"
              />
            </CardHeader>
            <CardContent className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Event</TableHead>
                    <TableHead>Required scope</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Description</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredEvents.map((event) => (
                    <TableRow key={event.event}>
                      <TableCell className="whitespace-nowrap">
                        <code className="font-mono text-xs">{event.event}</code>
                      </TableCell>
                      <TableCell>
                        {event.required_scope ? (
                          <code className="font-mono text-xs">{event.required_scope}</code>
                        ) : (
                          <span className="text-xs text-muted-foreground">—</span>
                        )}
                      </TableCell>
                      <TableCell className="space-x-1 whitespace-nowrap">
                        <Badge variant={event.emitted_in_v1 ? "default" : "outline"}>
                          {event.emitted_in_v1 ? "Emitted" : "Reserved"}
                        </Badge>
                        {!event.subscribable && (
                          <Badge variant="outline">Not subscribable</Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {event.description}
                      </TableCell>
                    </TableRow>
                  ))}
                  {filteredEvents.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={4} className="text-sm text-muted-foreground">
                        No events match that filter.
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          {[...webhookSections, ...webhookDeepSections].map((section) => (
            <Card key={section.heading}>
              <CardHeader>
                <CardTitle className="text-base">{section.heading}</CardTitle>
              </CardHeader>
              <CardContent>
                <DocsMarkdown>{section.body}</DocsMarkdown>
              </CardContent>
            </Card>
          ))}
        </TabsContent>

        {/* Scopes ---------------------------------------------------------- */}
        <TabsContent value="scopes" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">
                Scopes
                <span className="ml-2 text-xs font-normal text-muted-foreground">
                  {SCOPE_COUNT} scopes
                </span>
              </CardTitle>
            </CardHeader>
            <CardContent className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Scope</TableHead>
                    <TableHead>Permission</TableHead>
                    <TableHead>Routes</TableHead>
                    <TableHead>Events</TableHead>
                    <TableHead>Notes</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {DOC_SCOPES.map((scope) => (
                    <TableRow key={scope.scope}>
                      <TableCell className="whitespace-nowrap">
                        <code className="font-mono text-xs">{scope.scope}</code>
                      </TableCell>
                      <TableCell>{scopeLabel(scope.scope)}</TableCell>
                      <TableCell>{scope.routeCount}</TableCell>
                      <TableCell>{scope.eventCount}</TableCell>
                      <TableCell className="text-muted-foreground">
                        {SENSITIVE_SCOPE_NOTES[scope.scope] ?? "—"}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          {scopeSection.map((section) => (
            <Card key={section.heading}>
              <CardHeader>
                <CardTitle className="text-base">{section.heading}</CardTitle>
              </CardHeader>
              <CardContent>
                <DocsMarkdown>{section.body}</DocsMarkdown>
              </CardContent>
            </Card>
          ))}
        </TabsContent>

        {/* Changelog ------------------------------------------------------- */}
        <TabsContent value="changelog">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <FileText className="h-4 w-4" />
                API &amp; webhooks changelog
              </CardTitle>
            </CardHeader>
            <CardContent>
              <DocsMarkdown>{CHANGELOG_MD}</DocsMarkdown>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
