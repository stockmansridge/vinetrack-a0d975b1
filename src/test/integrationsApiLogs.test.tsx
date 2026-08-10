// Stage 4B — API request logs (SQL 177 integration_list_api_requests).
import { describe, expect, it, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const CLIENT_ID = "50a4535b-3740-4de8-9528-1de836d0fac7";

const rpcMock = vi.fn();
vi.mock("@/integrations/ios-supabase/client", () => ({
  supabase: { rpc: (fn: string, args: unknown) => rpcMock(fn, args) },
}));

import {
  apiRequestRpcArgs,
  apiStatusTone,
  nextApiRequestCursor,
  normaliseApiRequest,
  API_REQUEST_PAGE_SIZE,
} from "@/lib/integrationsQuery";
import { IntegrationApiLogsTab } from "@/components/integrations/IntegrationApiLogsTab";

const row = (over: Record<string, unknown> = {}) => ({
  id: "11111111-1111-1111-1111-111111111111",
  created_at: "2026-08-10T02:00:00.000Z",
  method: "GET",
  endpoint: "/v1/blocks",
  vineyard_id: "22222222-2222-2222-2222-222222222222",
  vineyard_name: "Home Block Estate",
  api_key_id: "33333333-3333-3333-3333-333333333333",
  api_key_name: "Stage 3A key",
  api_key_prefix: "vt_live_ab12",
  status_code: 200,
  duration_ms: 143,
  error_code: null,
  ...over,
});

function renderTab() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <IntegrationApiLogsTab clientId={CLIENT_ID} />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  rpcMock.mockReset();
  rpcMock.mockImplementation((fn: string) =>
    Promise.resolve({
      data: fn === "integration_list_api_requests" ? [row()] : [],
      error: null,
    }),
  );
});

describe("api request log helpers", () => {
  it("builds the exact SQL 177 argument set", () => {
    expect(
      apiRequestRpcArgs(CLIENT_ID, { errorOnly: true, statusCode: 403 }, null),
    ).toEqual({
      p_client_id: CLIENT_ID,
      p_from: null,
      p_to: null,
      p_status_code: 403,
      p_vineyard_id: null,
      p_api_key_id: null,
      p_error_only: true,
      p_limit: API_REQUEST_PAGE_SIZE,
      p_before_created_at: null,
      p_before_id: null,
    });
  });

  it("passes the keyset cursor, never an offset", () => {
    const args = apiRequestRpcArgs(
      CLIENT_ID,
      {},
      { created_at: "2026-08-01T00:00:00Z", id: "abc" },
    );
    expect(args.p_before_created_at).toBe("2026-08-01T00:00:00Z");
    expect(args.p_before_id).toBe("abc");
    expect(args).not.toHaveProperty("p_offset");
  });

  it("maps status codes to compact tones", () => {
    expect(apiStatusTone(200)).toBe("success");
    expect(apiStatusTone(204)).toBe("success");
    expect(apiStatusTone(403)).toBe("warning");
    expect(apiStatusTone(404)).toBe("warning");
    expect(apiStatusTone(500)).toBe("error");
    expect(apiStatusTone(null)).toBe("neutral");
  });

  it("only issues a next cursor when the page was full", () => {
    const rows = Array.from({ length: 3 }, (_, i) =>
      normaliseApiRequest(row({ id: `id-${i}` })),
    );
    expect(nextApiRequestCursor(rows, 3)).toEqual({
      created_at: "2026-08-10T02:00:00.000Z",
      id: "id-2",
    });
    expect(nextApiRequestCursor(rows, 100)).toBeNull();
  });
});

describe("IntegrationApiLogsTab", () => {
  it("calls the log RPC with the current integration id and renders rows", async () => {
    renderTab();
    await waitFor(() =>
      expect(rpcMock).toHaveBeenCalledWith(
        "integration_list_api_requests",
        expect.objectContaining({ p_client_id: CLIENT_ID, p_limit: 100 }),
      ),
    );
    expect(await screen.findByText("/v1/blocks")).toBeInTheDocument();
    expect(screen.getByText("200")).toBeInTheDocument();
    expect(screen.getByText("Home Block Estate")).toBeInTheDocument();
    expect(screen.getByText(/Stage 3A key · vt_live_ab12/)).toBeInTheDocument();
    expect(screen.getByText("143 ms")).toBeInTheDocument();
  });

  it("never renders hashes, secrets, headers or bodies", async () => {
    rpcMock.mockImplementation((fn: string) =>
      Promise.resolve({
        data:
          fn === "integration_list_api_requests"
            ? [
                row({
                  key_hash: "deadbeef",
                  secret: "vt_live_supersecretvalue",
                  request_body: "{}",
                }),
              ]
            : [],
        error: null,
      }),
    );
    const { container } = renderTab();
    await screen.findByText("/v1/blocks");
    expect(container.textContent).not.toContain("deadbeef");
    expect(container.textContent).not.toContain("supersecretvalue");
    expect(container.textContent).not.toContain("Authorization");
  });

  it("resets pagination and sends errors-only when the filter is toggled", async () => {
    renderTab();
    await screen.findByText("/v1/blocks");
    fireEvent.click(screen.getByLabelText("Errors only"));
    await waitFor(() =>
      expect(rpcMock).toHaveBeenCalledWith(
        "integration_list_api_requests",
        expect.objectContaining({
          p_error_only: true,
          p_before_created_at: null,
          p_before_id: null,
        }),
      ),
    );
  });

  it("sends the status-code filter", async () => {
    renderTab();
    await screen.findByText("/v1/blocks");
    fireEvent.change(screen.getByLabelText("Status code"), {
      target: { value: "500" },
    });
    await waitFor(() =>
      expect(rpcMock).toHaveBeenCalledWith(
        "integration_list_api_requests",
        expect.objectContaining({ p_status_code: 500 }),
      ),
    );
  });

  it("pages forward with the keyset cursor", async () => {
    const page = Array.from({ length: 100 }, (_, i) =>
      row({ id: `id-${i}`, created_at: `2026-08-1${i % 9}T02:00:00.000Z` }),
    );
    rpcMock.mockImplementation((fn: string) =>
      Promise.resolve({
        data: fn === "integration_list_api_requests" ? page : [],
        error: null,
      }),
    );
    renderTab();
    const next = await screen.findByRole("button", { name: /next page/i });
    await waitFor(() => expect(next).not.toBeDisabled());
    fireEvent.click(next);
    await waitFor(() =>
      expect(rpcMock).toHaveBeenCalledWith(
        "integration_list_api_requests",
        expect.objectContaining({
          p_before_id: "id-99",
          p_before_created_at: page[99].created_at,
        }),
      ),
    );
  });

  it("shows the filter-aware empty state", async () => {
    rpcMock.mockResolvedValue({ data: [], error: null });
    renderTab();
    expect(
      await screen.findByText("No API requests match the selected filters."),
    ).toBeInTheDocument();
    expect(screen.queryByText(/temporarily unavailable/i)).toBeNull();
  });

  it("shows a safe error state with retry", async () => {
    rpcMock.mockImplementation((fn: string) =>
      fn === "integration_list_api_requests"
        ? Promise.resolve({
            data: null,
            error: { message: 'relation "integration_api_requests" does not exist' },
          })
        : Promise.resolve({ data: [], error: null }),
    );
    renderTab();
    expect(
      await screen.findByText("API request logs could not be loaded."),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /retry/i })).toBeInTheDocument();
    expect(screen.queryByText(/relation/i)).toBeNull();
  });

  it("opens a detail drawer containing only safe fields", async () => {
    renderTab();
    fireEvent.click(await screen.findByText("/v1/blocks"));
    const dialog = await screen.findByRole("dialog");
    expect(dialog.textContent).toContain("Request ID");
    expect(dialog.textContent).toContain("vt_live_ab12");
    expect(dialog.textContent).not.toContain("Authorization");
    expect(dialog.textContent).not.toContain("hash");
  });

  it("never queries integration_api_requests directly", () => {
    const lib = readFileSync("src/lib/integrationsQuery.ts", "utf8");
    const tab = readFileSync(
      "src/components/integrations/IntegrationApiLogsTab.tsx",
      "utf8",
    );
    expect(lib).not.toMatch(/from\(["']integration_api_requests/);
    expect(tab).not.toMatch(/from\(["']integration_api_requests/);
    expect(lib).toContain("integration_list_api_requests");
  });
});
