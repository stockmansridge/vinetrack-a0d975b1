import { describe, it, expect } from "vitest";
import {
  API_ROUTES,
  API_ROUTE_COUNT,
  DOC_SCOPES,
  OPENAPI_YAML,
  SCOPE_COUNT,
  WEBHOOK_EVENTS,
  WEBHOOK_EVENT_COUNT,
  groupRoutesByTag,
  splitSections,
  CHANGELOG_MD,
  POSTMAN_COLLECTION,
  POSTMAN_FILENAME,
} from "@/lib/developerDocs";

describe("developer docs (canonical Stage 6A assets)", () => {
  it("parses the OpenAPI spec into routes", () => {
    expect(API_ROUTE_COUNT).toBeGreaterThan(20);
    expect(API_ROUTES.every((r) => r.method === "GET")).toBe(true);
    expect(API_ROUTES.some((r) => r.path === "/v1/me")).toBe(true);
  });

  it("derives required scopes from route descriptions", () => {
    const vineyards = API_ROUTES.find((r) => r.path === "/v1/vineyards");
    expect(vineyards?.scope).toBe("vineyards:read");
  });

  it("loads the webhook event catalogue", () => {
    expect(WEBHOOK_EVENT_COUNT).toBe(WEBHOOK_EVENTS.length);
    expect(WEBHOOK_EVENTS.some((e) => e.event === "webhook.test")).toBe(true);
    expect(WEBHOOK_EVENTS.find((e) => e.event === "spray_job.created")?.emitted_in_v1).toBe(false);
  });

  it("builds a scope catalogue including additive scopes", () => {
    const names = DOC_SCOPES.map((s) => s.scope);
    expect(names).toContain("costs:read");
    expect(names).toContain("labour:read");
    expect(names).toContain("team:read");
    expect(SCOPE_COUNT).toBe(DOC_SCOPES.length);
  });

  it("groups routes by tag", () => {
    const groups = groupRoutesByTag(API_ROUTES);
    expect(groups.length).toBeGreaterThan(1);
    expect(groups.flatMap((g) => g.routes).length).toBe(API_ROUTES.length);
  });

  it("splits markdown into level-2 sections", () => {
    const sections = splitSections(CHANGELOG_MD);
    expect(sections.length).toBeGreaterThan(0);
  });

  it("never embeds a real API key in the bundled spec", () => {
    expect(/vt_live_(?!REPLACE|\.\.\.|…)[A-Za-z0-9]{10,}/.test(OPENAPI_YAML)).toBe(false);
  });
});

describe("Postman collection bundle", () => {
  it("bundles the canonical Stage 6A collection verbatim", () => {
    expect(POSTMAN_FILENAME).toBe("VineTrack-v1.postman_collection.json");
    const parsed = JSON.parse(POSTMAN_COLLECTION);
    expect(parsed.info.name).toBe("VineTrack API v1");
    expect(parsed.info.schema).toContain("collection/v2.1.0");
    expect(Array.isArray(parsed.item)).toBe(true);
    expect(parsed.item.length).toBeGreaterThan(0);
  });

});
