import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { ProviderConnectionCard, providerCapabilityRows } from "@/components/weather/ProviderConnectionCard";

afterEach(cleanup);
const props = { name: "Davis WeatherLink", mark: "WeatherLink", icon: null, tone: "", description: "Station", provides: ["Live observations"], usedFor: [] };

describe("provider configuration entry", () => {
  it("opens existing configuration only on explicit action and closes without a save", () => {
    render(<ProviderConnectionCard {...props} configured><input aria-label="Existing station" defaultValue="North" /></ProviderConnectionCard>);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Configure Davis WeatherLink" }));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByLabelText("Existing station")).toHaveValue("North");
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("opens a connection form without enabling its protected actions", () => {
    render(<ProviderConnectionCard {...props}><input aria-label="Credential" disabled /></ProviderConnectionCard>);
    fireEvent.click(screen.getByRole("button", { name: "Connect Davis WeatherLink" }));
    expect(screen.getByLabelText("Credential")).toBeDisabled();
  });

  it("never opens a configuration form for a built-in provider", () => {
    render(<ProviderConnectionCard {...props} builtIn />);
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("compares Open-Meteo forecasts/archive without claiming station actuals", () => {
    expect(providerCapabilityRows(["Forecasts", "Historical rainfall archive"]).map(row => row.supported)).toEqual([true, false, false, true]);
  });

  it("compares Davis, Weather Underground and MAIT without claiming forecasts/archive", () => {
    expect(providerCapabilityRows(["Live observations", "Rainfall actuals"]).map(row => row.supported)).toEqual([false, true, true, false]);
  });

  it("compares WillyWeather as forecast-only", () => {
    expect(providerCapabilityRows(["Forecasts"]).map(row => row.supported)).toEqual([true, false, false, false]);
  });

  it("does not infer capabilities from unknown labels", () => {
    expect(providerCapabilityRows(["Unknown"]).every(row => !row.supported)).toBe(true);
  });
});