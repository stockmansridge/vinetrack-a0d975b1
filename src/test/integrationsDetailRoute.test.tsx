import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";

const CLIENT_ID = "50a4535b-3740-4de8-9528-1de836d0fac7";

vi.mock("@/context/VineyardContext", () => ({
  useVineyard: () => ({ currentRole: "owner", loading: false }),
}));

const clients = [
  {
    id: CLIENT_ID,
    name: "VineTrack Stage 3A Test",
    description: "Stage 3A production API gateway validation",
    integration_type: "custom_api",
    status: "active",
    created_at: null,
    updated_at: null,
    paused_at: null,
    revoked_at: null,
    last_request_at: null,
    vineyard_count: 1,
    scope_count: 17,
    api_key_count: 1,
    raw: {},
  },
];

vi.mock("@/lib/integrationsQuery", async () => {
  const actual = await vi.importActual<Record<string, unknown>>(
    "@/lib/integrationsQuery",
  );
  return {
    ...actual,
    useIntegrationClient: (clientId: string | undefined) => ({
      isLoading: false,
      isError: false,
      error: null,
      client: clients.find((c) => c.id === clientId) ?? null,
    }),
    useIntegrationVineyards: () => ({ data: [], isLoading: false }),
    useIntegrationScopes: () => ({ rows: [], isLoading: false }),
    useIntegrationApiKeys: () => ({ data: [], isLoading: false, isError: false }),
  };
});

vi.mock("@/components/integrations/IntegrationOverviewTab", () => ({
  IntegrationOverviewTab: () => <div>overview-tab</div>,
}));
vi.mock("@/components/integrations/IntegrationVineyardsTab", () => ({
  IntegrationVineyardsTab: () => <div>vineyards-tab</div>,
}));
vi.mock("@/components/integrations/IntegrationPermissionsTab", () => ({
  IntegrationPermissionsTab: () => <div>permissions-tab</div>,
}));
vi.mock("@/components/integrations/IntegrationApiKeysTab", () => ({
  IntegrationApiKeysTab: () => <div>keys-tab</div>,
}));
vi.mock("@/components/integrations/IntegrationApiLogsTab", () => ({
  IntegrationApiLogsTab: () => <div>logs-tab</div>,
}));
vi.mock("@/components/integrations/IntegrationAuditTab", () => ({
  IntegrationAuditTab: () => <div>audit-tab</div>,
}));
vi.mock("@/components/integrations/IntegrationWebhooksTab", () => ({
  IntegrationWebhooksTab: () => <div>webhooks-tab</div>,
}));

import IntegrationDetailPage from "@/pages/settings/IntegrationDetailPage";

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route
          path="/settings/integrations/:clientId"
          element={<IntegrationDetailPage />}
        />
      </Routes>
    </MemoryRouter>,
  );
}

describe("integration detail route", () => {
  it("resolves the integration from the route UUID", () => {
    renderAt(`/settings/integrations/${CLIENT_ID}`);
    expect(screen.getByText("VineTrack Stage 3A Test")).toBeInTheDocument();
    expect(screen.getByText("Permissions")).toBeInTheDocument();
    expect(screen.getByText("API Keys")).toBeInTheDocument();
    expect(screen.getByText("Audit History")).toBeInTheDocument();
    expect(screen.getByText("Webhooks")).toBeInTheDocument();
  });

  it("shows a non-disclosing not-found for an unknown or unauthorised id", () => {
    renderAt("/settings/integrations/11111111-1111-1111-1111-111111111111");
    expect(
      screen.getByText(
        /could not be found or you no longer have access/i,
      ),
    ).toBeInTheDocument();
  });

  it("declares the same route param name the page reads", () => {
    const app = readFileSync("src/App.tsx", "utf8");
    const page = readFileSync(
      "src/pages/settings/IntegrationDetailPage.tsx",
      "utf8",
    );
    expect(app).toContain("/settings/integrations/:clientId");
    expect(page).toContain("params.clientId");
  });

  it("never reads integration tables directly", () => {
    const lib = readFileSync("src/lib/integrationsQuery.ts", "utf8");
    expect(lib).not.toMatch(/from\("integration_clients/);
    expect(lib).not.toMatch(/from\("integration_api_keys/);
  });
});
