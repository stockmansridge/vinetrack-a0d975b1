import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { ProviderConnectionCard } from "@/components/weather/ProviderConnectionCard";

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
});