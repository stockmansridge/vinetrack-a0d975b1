import { describe, expect, it } from "vitest";
import {
  ADMIN_PAGE_SIZE,
  adminApiRequestsArgs,
  adminIntegrationsArgs,
  asRows,
  healthReasons,
  nextCursor,
  normaliseAdminIntegration,
  normaliseAdminIntegrationDetail,
  normaliseApiMetrics,
  normaliseWebhookMetrics,
  safeAuditSummary,
  safeKeyLabel,
} from "@/lib/adminIntegrationsQuery";

describe("adminIntegrationsQuery", () => {
  it("normalises jsonb rows in either shape", () => {
    expect(asRows([{ id: "a" }])).toHaveLength(1);
    expect(asRows({ rows: [{ id: "a" }] })).toHaveLength(1);
    expect(asRows(null)).toEqual([]);
  });

  it("uses backend health and reasons, never client-derived", () => {
    const row = normaliseAdminIntegration({
      id: "1",
      name: "Acme",
      status: "active",
      health: "critical",
      health_reasons: ["webhook_failures"],
      api_errors_24h: 0,
    });
    expect(row.health).toBe("critical");
    expect(row.health_reasons).toEqual(["webhook_failures"]);
    expect(healthReasons({ health_reason: "single" })).toEqual(["single"]);
  });

  it("builds keyset cursors from the last row", () => {
    const rows = [
      { id: "1", created_at: "2026-01-01T00:00:00Z" },
      { id: "2", created_at: "2026-01-02T00:00:00Z" },
    ];
    expect(nextCursor(rows)).toEqual({
      beforeCreatedAt: "2026-01-02T00:00:00Z",
      beforeId: "2",
    });
    expect(nextCursor([])).toBeNull();
  });

  it("maps filters to Stage 7A rpc parameters", () => {
    const args = adminIntegrationsArgs(
      { status: "active", errorsOnly: true, ownerQuery: "acme" },
      { beforeCreatedAt: "2026-01-02T00:00:00Z", beforeId: "2" },
      ADMIN_PAGE_SIZE,
    );
    expect(args.p_status).toBe("active");
    expect(args.p_errors_only).toBe(true);
    expect(args.p_owner_query).toBe("acme");
    expect(args.p_before_id).toBe("2");
    expect(args.p_limit).toBe(ADMIN_PAGE_SIZE);

    const req = adminApiRequestsArgs("c1", { statusClass: "5xx" }, null, 25);
    expect(req.p_client_id).toBe("c1");
    expect(req.p_status_class).toBe("5xx");
    expect(req.p_limit).toBe(25);
  });

  it("normalises metrics payloads", () => {
    const api = normaliseApiMetrics({
      total_requests: 10,
      buckets: [{ bucket: "2026-01-01T00:00:00Z", total: 10 }],
    });
    expect(api.total_requests).toBe(10);
    expect(api.buckets).toHaveLength(1);

    const hooks = normaliseWebhookMetrics({ delivered: 5, failed: 2 });
    expect(hooks.delivered).toBe(5);
    expect(hooks.failed).toBe(2);
  });

  it("never exposes secret material for keys or audit entries", () => {
    expect(
      safeKeyLabel({ name: "CI key", key_prefix: "vt_live_abc", secret: "should-not-render" }),
    ).toBe("CI key (vt_live_abc…)");
    const summary = safeAuditSummary({
      id: "a",
      created_at: null,
      action: "api_key.revoked",
      actor_type: "platform_admin",
      actor_label: null,
      client_id: null,
      client_name: null,
      is_platform_admin: true,
      summary: null,
      metadata: { api_key_secret: "nope", key_id: "k1" },
    });
    expect(summary).not.toContain("nope");
  });

  it("reads detail payloads nested under integration", () => {
    const detail = normaliseAdminIntegrationDetail({
      integration: { id: "1", name: "Acme", status: "active", health: "healthy" },
      scopes: [{ scope: "pins.read" }],
      api_keys: [{ id: "k1" }],
    });
    expect(detail?.name).toBe("Acme");
    expect(detail?.scopes).toHaveLength(1);
    expect(detail?.api_keys).toHaveLength(1);
    expect(normaliseAdminIntegrationDetail({})).toBeNull();
  });
});
