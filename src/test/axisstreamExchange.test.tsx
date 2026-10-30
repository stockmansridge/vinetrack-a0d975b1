import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { readFileSync } from "fs";

const rpc = vi.fn();
const invoke = vi.fn();
let admin = true;
vi.mock("@/integrations/ios-supabase/client", () => ({ supabase: { rpc: (...a: any[]) => rpc(...a), functions: { invoke: (...a: any[]) => invoke(...a) } } }));
vi.mock("@/lib/systemAdmin", () => ({ useIsSystemAdmin: () => ({ isAdmin: admin, loading: false }) }));

import { AxisStreamCard } from "@/components/weather/AxisStreamCard";
import { buildAxisSavePayload, describeAxisTestError, normaliseAxisConfig } from "@/lib/axisstreamExchange";
import { PROVIDER_PROVIDES } from "@/lib/weatherSourceSummary";

const cfg = (over: any = {}) => ({ data: { vineyard_id: "v1", connection: { configured: true, mode: "testing", live_publish_enabled: false, selected_weather_code: "W1", selected_rain_code: null, selected_leaf_code: null, last_tested_at: null, last_test_status: "success", last_test_summary: { counts: { weather: 1, rain_gauge: 2, leaf_wetness: 0 }, devices: 3, staged_readings: 9 }, ...over }, devices: [{ project_code: "P1", dataset: "weather", code: "W1", name: "Station A" }, { project_code: "P2", dataset: "weather", code: "W1", name: "Station B" }, { project_code: "P1", dataset: "rain_gauge", code: "R1", name: "Gauge" }], staged_reading_count: 9, scope: "testing" }, error: null });
const wrap = (ui: any) => render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{ui}</QueryClientProvider>);
const openDialog = async () => { fireEvent.click(await screen.findByRole("button", { name: /(Configure|Connect) AxisStream Exchange/ })); await screen.findByTestId("axisstream-dialog"); };

beforeEach(() => { rpc.mockReset(); invoke.mockReset(); admin = true; localStorage.clear(); });

describe("AxisStream Exchange (test-only)", () => {
  it("hides entirely for non-admins and never queries", () => {
    admin = false;
    wrap(<AxisStreamCard vineyardId="v1" />);
    expect(screen.queryByText("AxisStream Exchange")).toBeNull();
    expect(rpc).not.toHaveBeenCalled();
  });

  it("shows testing-only label and never reads token back", async () => {
    rpc.mockResolvedValue(cfg({ token: "SECRET" }));
    wrap(<AxisStreamCard vineyardId="v1" />);
    expect(await screen.findByText("Testing only · Not active")).toBeTruthy();
    expect(screen.queryByLabelText(/token/i)).toBeNull();
    await openDialog();
    expect(normaliseAxisConfig(cfg({ token: "SECRET" }).data)).not.toHaveProperty("token");
    expect(document.body.innerHTML).not.toContain("SECRET");
  });

  it("saving a token sends testing mode, clears input, no localStorage", async () => {
    rpc.mockResolvedValue(cfg());
    wrap(<AxisStreamCard vineyardId="v1" />);
    await openDialog();
    await screen.findByText("Configured · testing");
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
    const bad = "AxisStream returned a non-success status; verify Exchange token";
    expect(describeAxisTestError(502, { ok: false, message: bad })).toBe(bad);
    expect(describeAxisTestError(502, null)).toBe(bad);
    const t = describeAxisTestError(409, { ok: false, error: "minimum_15_minute_interval", retry_after_seconds: 300 });
    expect(t).toMatch(/15 minutes/); expect(t).toMatch(/5 min/);
  });

  it("parses deployed contract: configured, selected codes, distinct device keys, object summary", () => {
    const n = normaliseAxisConfig(cfg().data);
    expect(n.configured).toBe(true); expect(n.weatherCode).toBe("W1"); expect(n.rainCode).toBeNull();
    expect(new Set(n.devices.map((d) => d.key)).size).toBe(3);
    expect(n.devices[0].kind).toBe("weather");
    expect(n.summary).toBe("1 weather, 2 rain gauge, 0 leaf wetness · 3 devices · 9 staged readings");
    expect(n.stagedReadingCount).toBe(9);
    expect(normaliseAxisConfig({ connection: { configured: false } }).configured).toBe(false);
  });

  it("test disabled unless configured and testing", async () => {
    rpc.mockResolvedValue(cfg({ mode: "disabled" }));
    wrap(<AxisStreamCard vineyardId="v1" />);
    await openDialog();
    await screen.findByText("Configured · disabled");
    expect((screen.getByText("Test Connection").closest("button") as HTMLButtonElement).disabled).toBe(true);
  });

  it("test calls only the preview function with action test", async () => {
    rpc.mockResolvedValue(cfg());
    invoke.mockResolvedValue({ data: { ok: true, status: "success", counts: { weather: 1, rain_gauge: 1, leaf_wetness: 0 }, devices: 2, staged_readings: 4 }, error: null });
    wrap(<AxisStreamCard vineyardId="v1" />);
    await openDialog();
    const btn = (await screen.findByText("Test Connection")).closest("button")!;
    await waitFor(() => expect(btn.disabled).toBe(false));
    fireEvent.click(btn);
    expect(await screen.findByText(/2 devices · 4 staged readings/)).toBeTruthy();
    expect(invoke).toHaveBeenCalledWith("axisstream-exchange-preview", { body: { vineyard_id: "v1", action: "test" } });
  });

  it("vineyard switch reloads config for the new vineyard", async () => {
    rpc.mockResolvedValue(cfg());
    const r = wrap(<AxisStreamCard vineyardId="v1" />);
    await screen.findAllByText("Testing only · Not active");
    r.rerender(<QueryClientProvider client={new QueryClient()}><AxisStreamCard vineyardId="v2" /></QueryClientProvider>);
    await waitFor(() => expect(rpc).toHaveBeenCalledWith("get_axisstream_exchange_configuration", { p_vineyard_id: "v2" }));
  });

  it("is never a selectable weather/rainfall source", () => {
    expect(Object.keys(PROVIDER_PROVIDES).join(",")).not.toMatch(/axis/i);
    for (const f of ["src/lib/localObservationProvider.ts", "src/lib/weatherSourceSummary.ts"]) expect(readFileSync(f, "utf8")).not.toMatch(/axis/i);
  });

  it("uses the shared vineyard backend client, never Lovable Cloud", () => {
    const src = readFileSync("src/lib/axisstreamExchange.ts", "utf8");
    expect(src).toContain('from "@/integrations/ios-supabase/client"');
    expect(src).not.toMatch(/@\/integrations\/supabase\/client/);
    const card = readFileSync("src/components/weather/AxisStreamCard.tsx", "utf8");
    expect(card).not.toMatch(/integrations\/supabase\/client/);
  });
});
