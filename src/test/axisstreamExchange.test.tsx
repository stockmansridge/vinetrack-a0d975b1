import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { readFileSync } from "fs";

const rpc = vi.fn();
const invoke = vi.fn();
let admin = true;
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc: (...a: any[]) => rpc(...a), functions: { invoke: (...a: any[]) => invoke(...a) } } }));
vi.mock("@/lib/systemAdmin", () => ({ useIsSystemAdmin: () => ({ isAdmin: admin, loading: false }) }));

import { AxisStreamCard } from "@/components/weather/AxisStreamCard";
import { buildAxisSavePayload, describeAxisTestError, normaliseAxisConfig } from "@/lib/axisstreamExchange";
import { PROVIDER_PROVIDES } from "@/lib/weatherSourceSummary";

const cfg = (over: any = {}) => ({ data: { connection: { id: "c", has_token: true, mode: "testing", weather_code: "W1", ...over }, devices: [{ device_code: "W1", name: "Station A" }, { device_code: "R1", name: "Gauge" }] }, error: null });
const wrap = (ui: any) => render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{ui}</QueryClientProvider>);

beforeEach(() => { rpc.mockReset(); invoke.mockReset(); admin = true; localStorage.clear(); });

describe("AxisStream Exchange (test-only)", () => {
  it("hides entirely for non-admins and never queries", () => {
    admin = false;
    wrap(<AxisStreamCard vineyardId="v1" />);
    expect(screen.queryByTestId("axisstream-card")).toBeNull();
    expect(rpc).not.toHaveBeenCalled();
  });

  it("shows testing-only label and never reads token back", async () => {
    rpc.mockResolvedValue(cfg({ token: "SECRET" }));
    wrap(<AxisStreamCard vineyardId="v1" />);
    expect(await screen.findByText("Testing only · Not active")).toBeTruthy();
    expect(normaliseAxisConfig(cfg({ token: "SECRET" }).data)).not.toHaveProperty("token");
    expect(document.body.innerHTML).not.toContain("SECRET");
  });

  it("saving a token sends testing mode, clears input, no localStorage", async () => {
    rpc.mockResolvedValue(cfg());
    wrap(<AxisStreamCard vineyardId="v1" />);
    const input = (await screen.findByLabelText("Replace token")) as HTMLInputElement;
    fireEvent.change(input, { target: { value: " tok123 " } });
    fireEvent.click(screen.getByText("Save"));
    await waitFor(() => expect(rpc).toHaveBeenCalledWith("save_axisstream_exchange_configuration", expect.objectContaining({ p_token: "tok123", p_mode: "testing" })));
    await waitFor(() => expect(input.value).toBe(""));
    expect(JSON.stringify(localStorage)).not.toContain("tok123");
  });

  it("editing selectors preserves stored token (null) and no mode change", () => {
    const p = buildAxisSavePayload("v1", { rainCode: "R1" });
    expect(p.p_token).toBeNull();
    expect(p.p_mode).toBeNull();
    expect(() => buildAxisSavePayload("v1", { mode: "live" as any })).toThrow();
  });

  it("maps invalid, expired and throttled errors", () => {
    expect(describeAxisTestError(502, { error_code: "invalid_token" })).toMatch(/rejected/);
    expect(describeAxisTestError(502, { error_code: "token_expired" })).toMatch(/expired/);
    expect(describeAxisTestError(409, { error_code: "throttled" })).toMatch(/15 minutes/);
  });

  it("test calls only the preview function with action test", async () => {
    rpc.mockResolvedValue(cfg());
    invoke.mockResolvedValue({ data: { ok: true, summary: "2 devices staged" }, error: null });
    wrap(<AxisStreamCard vineyardId="v1" />);
    fireEvent.click(await screen.findByText("Test Connection"));
    expect(await screen.findByText("2 devices staged")).toBeTruthy();
    expect(invoke).toHaveBeenCalledWith("axisstream-exchange-preview", { body: { vineyard_id: "v1", action: "test" } });
  });

  it("vineyard switch reloads config for the new vineyard", async () => {
    rpc.mockResolvedValue(cfg());
    const r = wrap(<AxisStreamCard vineyardId="v1" />);
    await screen.findByText("Testing only · Not active");
    r.rerender(<QueryClientProvider client={new QueryClient()}><AxisStreamCard vineyardId="v2" /></QueryClientProvider>);
    await waitFor(() => expect(rpc).toHaveBeenCalledWith("get_axisstream_exchange_configuration", { p_vineyard_id: "v2" }));
  });

  it("is never a selectable weather/rainfall source", () => {
    expect(Object.keys(PROVIDER_PROVIDES).join(",")).not.toMatch(/axis/i);
    for (const f of ["src/lib/localObservationProvider.ts", "src/lib/weatherSourceSummary.ts"]) expect(readFileSync(f, "utf8")).not.toMatch(/axis/i);
  });
});
