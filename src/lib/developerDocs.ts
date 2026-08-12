// Stage 6B — Developer documentation data layer.
//
// The canonical Stage 6A assets are the ONLY source of truth for the
// documentation surface. Nothing here invents routes, events or scopes:
// everything is derived from
//   docs/openapi/vinetrack-v1.yaml            (REST catalogue)
//   docs/webhooks/vinetrack-events-v1.json    (event catalogue)
//   docs/vinetrack-developer-platform.md      (developer guide)
//   docs/vinetrack-webhooks.md                (deep webhook reference)
//   docs/vinetrack-api-changelog.md           (change history)
import YAML from "yaml";
import openApiRaw from "../../docs/openapi/vinetrack-v1.yaml?raw";
import eventCatalogue from "../../docs/webhooks/vinetrack-events-v1.json";
import developerGuideRaw from "../../docs/vinetrack-developer-platform.md?raw";
import webhookGuideRaw from "../../docs/vinetrack-webhooks.md?raw";
import changelogRaw from "../../docs/vinetrack-api-changelog.md?raw";
import postmanCollectionRaw from "../../docs/postman/VineTrack-v1.postman_collection.json?raw";

export const OPENAPI_YAML = openApiRaw;
export const OPENAPI_FILENAME = "vinetrack-v1.yaml";
export const DEVELOPER_GUIDE_MD = developerGuideRaw;
export const WEBHOOK_GUIDE_MD = webhookGuideRaw;
export const CHANGELOG_MD = changelogRaw;

// Canonical Stage 6A Postman collection, bundled verbatim — never regenerated
// or reshaped here.
export const POSTMAN_COLLECTION: string = postmanCollectionRaw;
export const POSTMAN_FILENAME = "VineTrack-v1.postman_collection.json";

// ---------------------------------------------------------------------------
// OpenAPI
// ---------------------------------------------------------------------------

interface OpenApiOperation {
  tags?: string[];
  summary?: string;
  description?: string;
  parameters?: unknown[];
}

interface OpenApiDoc {
  info?: { title?: string; version?: string; description?: string };
  servers?: { url?: string }[];
  tags?: { name?: string }[];
  paths?: Record<string, Record<string, OpenApiOperation>>;
}

const spec = YAML.parse(openApiRaw) as OpenApiDoc;

export interface ApiRoute {
  method: string;
  path: string;
  tag: string;
  summary: string;
  description: string;
  scope: string | null;
  hasPathParam: boolean;
  /** True when the operation declares the Idempotency-Key header (all POST writes). */
  requiresIdempotencyKey: boolean;
  /** True when the operation requires expected_updated_at (all PATCH writes). */
  requiresExpectedUpdatedAt: boolean;
  /** Documented response status codes, in ascending order. */
  statusCodes: string[];
}

function extractScope(description: string): string | null {
  const match = description.match(/Scope:\s*([a-z_]+:[a-z_]+)/i);
  return match ? match[1] : null;
}

export const API_INFO = {
  title: spec.info?.title ?? "VineTrack API",
  version: spec.info?.version ?? "v1",
  description: spec.info?.description ?? "",
  serverUrl: spec.servers?.[0]?.url ?? "",
};

export const API_ROUTES: ApiRoute[] = Object.entries(spec.paths ?? {})
  .flatMap(([path, methods]) =>
    Object.entries(methods ?? {})
      .filter(([method]) => ["get", "post", "put", "patch", "delete"].includes(method))
      .map(([method, op]) => {
        const description = (op?.description ?? "").trim();
        const params = JSON.stringify(op?.parameters ?? []);
        const responses = (op as { responses?: Record<string, unknown> })?.responses ?? {};
        return {
          method: method.toUpperCase(),
          path,
          tag: op?.tags?.[0] ?? "Other",
          summary: (op?.summary ?? "").trim(),
          description,
          scope: extractScope(description),
          hasPathParam: path.includes("{"),
          requiresIdempotencyKey:
            /idempotencyKey|Idempotency-Key/i.test(params) ||
            /Idempotency-Key/i.test(description),
          requiresExpectedUpdatedAt: /expected_updated_at/i.test(
            description + JSON.stringify((op as Record<string, unknown>)?.requestBody ?? {}),
          ),
          statusCodes: Object.keys(responses)
            .filter((code) => /^\d{3}$/.test(code))
            .sort(),
        };
      }),
  )
  .sort((a, b) => a.path.localeCompare(b.path));

export const API_ROUTE_COUNT = API_ROUTES.length;

/** Every non-GET route the canonical spec publishes (Stage 8 writes). */
export const WRITE_ROUTES: ApiRoute[] = API_ROUTES.filter((r) => r.method !== "GET");

/** HTTP methods present in the canonical spec (GET/POST/PATCH in Stage 8). */
export const API_METHODS: string[] = [...new Set(API_ROUTES.map((r) => r.method))].sort();

/** The spec must never publish a DELETE route. */
export const HAS_DELETE_ROUTE = API_ROUTES.some((r) => r.method === "DELETE");

/**
 * Write scopes that are actually usable — derived from the canonical OpenAPI
 * write routes, never hand-listed, so a spec change cannot silently drift.
 */
export const ACTIVE_WRITE_SCOPES: string[] = [
  ...new Set(WRITE_ROUTES.map((r) => r.scope).filter((s): s is string => Boolean(s))),
].sort();

/**
 * Reserved write scopes documented as unavailable in §4 of the developer
 * guide. They exist in the backend catalogue but no public route accepts them.
 */
export const RESERVED_WRITE_SCOPES: string[] = [
  "trips:write",
  "sprays:write",
  "pruning:write",
  "equipment:write",
  "pins:write",
].filter((s) => !ACTIVE_WRITE_SCOPES.includes(s));


export const API_TAG_ORDER: string[] = (spec.tags ?? [])
  .map((t) => t?.name)
  .filter((n): n is string => Boolean(n));

export function groupRoutesByTag(routes: ApiRoute[]): { tag: string; routes: ApiRoute[] }[] {
  const groups = new Map<string, ApiRoute[]>();
  for (const route of routes) {
    const list = groups.get(route.tag) ?? [];
    list.push(route);
    groups.set(route.tag, list);
  }
  const ordered = [...groups.keys()].sort((a, b) => {
    const ai = API_TAG_ORDER.indexOf(a);
    const bi = API_TAG_ORDER.indexOf(b);
    if (ai === -1 && bi === -1) return a.localeCompare(b);
    if (ai === -1) return 1;
    if (bi === -1) return -1;
    return ai - bi;
  });
  return ordered.map((tag) => ({ tag, routes: groups.get(tag) ?? [] }));
}

// ---------------------------------------------------------------------------
// Webhook events
// ---------------------------------------------------------------------------

export interface WebhookEventDef {
  event: string;
  resource_type: string;
  required_scope: string | null;
  vineyard_scoped: boolean;
  emitted_in_v1: boolean;
  subscribable: boolean;
  description: string;
}

const catalogue = eventCatalogue as {
  api_version?: string;
  events?: WebhookEventDef[];
};

export const WEBHOOK_EVENTS: WebhookEventDef[] = (catalogue.events ?? []).map((e) => ({
  event: e.event,
  resource_type: e.resource_type,
  required_scope: e.required_scope ?? null,
  vineyard_scoped: Boolean(e.vineyard_scoped),
  emitted_in_v1: Boolean(e.emitted_in_v1),
  subscribable: Boolean(e.subscribable),
  description: e.description ?? "",
}));

export const WEBHOOK_EVENT_COUNT = WEBHOOK_EVENTS.length;
export const WEBHOOK_EVENTS_EMITTED = WEBHOOK_EVENTS.filter((e) => e.emitted_in_v1).length;
export const CATALOGUE_API_VERSION = catalogue.api_version ?? "v1";

export function groupEventsByResource(): { resource: string; events: WebhookEventDef[] }[] {
  const groups = new Map<string, WebhookEventDef[]>();
  for (const event of WEBHOOK_EVENTS) {
    const list = groups.get(event.resource_type) ?? [];
    list.push(event);
    groups.set(event.resource_type, list);
  }
  return [...groups.entries()].map(([resource, events]) => ({ resource, events }));
}

// ---------------------------------------------------------------------------
// Scopes (union of everything the canonical assets reference)
// ---------------------------------------------------------------------------

export interface DocScope {
  scope: string;
  routeCount: number;
  eventCount: number;
}

export const DOC_SCOPES: DocScope[] = (() => {
  const scopes = new Map<string, DocScope>();
  const ensure = (scope: string) => {
    const existing = scopes.get(scope);
    if (existing) return existing;
    const created: DocScope = { scope, routeCount: 0, eventCount: 0 };
    scopes.set(scope, created);
    return created;
  };

  for (const route of API_ROUTES) {
    if (route.scope) ensure(route.scope).routeCount += 1;
  }
  for (const event of WEBHOOK_EVENTS) {
    if (event.required_scope) ensure(event.required_scope).eventCount += 1;
  }
  // Sensitive/additive scopes are documented in the guide's scope table rather
  // than attached to a single route; surface them explicitly.
  for (const scope of ["costs:read", "labour:read", "team:read"]) ensure(scope);

  return [...scopes.values()].sort((a, b) => a.scope.localeCompare(b.scope));
})();

export const SCOPE_COUNT = DOC_SCOPES.length;

// ---------------------------------------------------------------------------
// Markdown helpers
// ---------------------------------------------------------------------------

export interface MarkdownSection {
  heading: string;
  body: string;
}

/** Split a markdown document into its level-2 sections, in document order. */
export function splitSections(markdown: string): MarkdownSection[] {
  const lines = markdown.split("\n");
  const sections: MarkdownSection[] = [];
  let heading: string | null = null;
  let buffer: string[] = [];
  let inFence = false;

  const flush = () => {
    if (heading !== null) sections.push({ heading, body: buffer.join("\n").trim() });
    buffer = [];
  };

  for (const line of lines) {
    if (line.trimStart().startsWith("```")) inFence = !inFence;
    if (!inFence && line.startsWith("## ")) {
      flush();
      heading = line.slice(3).trim();
      continue;
    }
    if (heading !== null) buffer.push(line);
  }
  flush();
  return sections;
}

export function sectionsByHeadingPrefix(
  markdown: string,
  prefixes: string[],
): MarkdownSection[] {
  const sections = splitSections(markdown);
  return prefixes
    .map((prefix) =>
      sections.find((s) => s.heading.toLowerCase().startsWith(prefix.toLowerCase())),
    )
    .filter((s): s is MarkdownSection => Boolean(s));
}

/** Split a markdown document into its level-3 subsections, in document order. */
export function splitSubsections(markdown: string): MarkdownSection[] {
  const lines = markdown.split("\n");
  const sections: MarkdownSection[] = [];
  let heading: string | null = null;
  let buffer: string[] = [];
  let inFence = false;

  const flush = () => {
    if (heading !== null) sections.push({ heading, body: buffer.join("\n").trim() });
    buffer = [];
  };

  for (const line of lines) {
    if (line.trimStart().startsWith("```")) inFence = !inFence;
    if (!inFence && (line.startsWith("### ") || line.startsWith("## "))) {
      flush();
      heading = line.startsWith("### ") ? line.slice(4).trim() : null;
      continue;
    }
    if (heading !== null) buffer.push(line);
  }
  flush();
  return sections;
}

export function subsectionByHeadingPrefix(
  markdown: string,
  prefix: string,
): MarkdownSection | null {
  return (
    splitSubsections(markdown).find((s) =>
      s.heading.toLowerCase().startsWith(prefix.toLowerCase()),
    ) ?? null
  );
}

/** Canonical "Writing data" content — Stage 8 write API section of the guide. */
export const WRITE_API_SECTION = subsectionByHeadingPrefix(DEVELOPER_GUIDE_MD, "6b.");

/** Canonical write-scope table (§4 "Write scopes (Stage 8)"). */
export const WRITE_SCOPES_SECTION = subsectionByHeadingPrefix(
  DEVELOPER_GUIDE_MD,
  "Write scopes",
);

/** Trigger a client-side download of a text asset. No network call, no key. */
export function downloadTextFile(filename: string, contents: string, mime: string) {
  const blob = new Blob([contents], { type: mime });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}
