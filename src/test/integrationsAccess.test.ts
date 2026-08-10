import { describe, it, expect } from "vitest";
import { canAccessRoute } from "@/lib/rolePermissions";
import { SCOPE_LABELS, isSensitiveScope, isWriteScope } from "@/lib/integrationsQuery";

describe("Integrations & API access", () => {
  it("is owner-only", () => {
    expect(canAccessRoute("/settings/integrations", "owner")).toBe(true);
    for (const role of ["manager", "supervisor", "operator", null]) {
      expect(canAccessRoute("/settings/integrations", role as string | null)).toBe(false);
    }
  });

  it("applies the same rule to nested integration routes", () => {
    expect(canAccessRoute("/settings/integrations/abc", "owner")).toBe(true);
    expect(canAccessRoute("/settings/integrations/docs", "manager")).toBe(false);
  });

  it("labels every catalogued scope", () => {
    for (const [scope, label] of Object.entries(SCOPE_LABELS)) {
      expect(label.length).toBeGreaterThan(0);
      expect(scope).toContain(":");
    }
  });

  it("flags sensitive scopes", () => {
    expect(isSensitiveScope("labour:read")).toBe(true);
    expect(isSensitiveScope("costs:read")).toBe(true);
    expect(isSensitiveScope("trips:read")).toBe(false);
  });

  it("flags write scopes as unavailable read-only API", () => {
    expect(isWriteScope("trips:write")).toBe(true);
    expect(isWriteScope("trips:read")).toBe(false);
  });
});
