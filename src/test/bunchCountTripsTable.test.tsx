import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import BunchCountTripsPanel from "@/components/yield/BunchCountTripsPanel";
import { buildBunchCountTrips } from "@/lib/bunchCountTrips";

vi.mock("@/lib/useRegionFormatters", () => ({
  useRegionFormatters: () => ({ areaUnitLabel: "ha", date: (v: string) => v.slice(0, 10) }),
}));

const blocks = [
  { id: "a", name: "North Shiraz", areaHa: 2, vineCount: 1000 },
  { id: "b", name: "South Chardonnay", areaHa: 1, vineCount: 500 },
  { id: "c", name: "Unsampled Merlot", areaHa: 4, vineCount: 2000 },
];

function setup({ weight = 200, multiple = false, unsampled = false, applyDamage = false }:
  { weight?: number | null; multiple?: boolean; unsampled?: boolean; applyDamage?: boolean } = {}) {
  const trips = buildBunchCountTrips([{
    id: "trip", is_completed: true, completed_at: "2026-10-01T00:00:00Z",
    payload: {
      selectedPaddockIds: multiple ? ["a", "b", ...(unsampled ? ["c"] : [])] : ["a"],
      applyDamage,
      // Historical evidence must not fill a missing current master weight.
      blockBunchWeightsKg: { a: 0.15, b: 0.15 },
      sampleSites: [
        { paddockId: "a", bunchCountEntry: { bunchesPerVine: 20 } },
        { paddockId: "a", bunchCountEntry: { bunchesPerVine: 30 } },
        ...(multiple ? [{ paddockId: "b", bunchCountEntry: { bunchesPerVine: 20 } }] : []),
      ],
    },
  }], {
    blocks, vintageOf: () => 2027, damageFactor: () => 0.8,
    bunchWeightFor: () => ({ grams: weight, source: weight == null ? "not_configured" : "variety_default" }),
  });
  const trip = trips[0];
  if (!trip) throw new Error("Trip fixture missing");
  const onOpenTrip = vi.fn();
  render(<BunchCountTripsPanel trips={trips} currentEstimates={new Map()} liveTripIds={new Set()} onOpenTrip={onOpenTrip} />);
  const row = screen.getByTestId("trip-row-trip");
  const cells = within(row).getAllByRole("cell");
  return { trip, row, cells, onOpenTrip };
}

describe("Yield Estimate Trips table", () => {
  it("uses configured master weight for numeric tonnes, not the historical 150 g", () => {
    const { trip, cells } = setup();
    expect(trip.totalEstimatedTonnes).toBe(5);
    expect(cells[5]).toHaveTextContent(/^5$/);
  });

  it("shows tonnes divided by total sampled area for multiple blocks", () => {
    const { trip, cells } = setup({ multiple: true });
    expect(trip.totalEstimatedTonnes).toBe(7);
    expect(trip.summary.totalAreaHa).toBe(3);
    expect(trip.summary.sampledAreaHa).toBe(3);
    expect(cells[6]).toHaveTextContent(/^2\.33 t\/ha$/);
  });

  it("shows dashes without a master even when historical weights exist", () => {
    const { trip, cells } = setup({ weight: null });
    expect(trip.totalEstimatedTonnes).toBeNull();
    expect(cells[5]).toHaveTextContent(/^—$/);
    expect(cells[6]).toHaveTextContent(/^—$/);
  });

  it("excludes selected blocks without recorded samples from the density denominator", () => {
    const { trip, cells } = setup({ multiple: true, unsampled: true });
    expect(trip.summary.blocks.find((b) => b.blockId === "c")?.recordedCount).toBe(0);
    expect(trip.summary.totalAreaHa).toBe(7);
    expect(trip.summary.sampledAreaHa).toBe(3);
    expect(trip.totalEstimatedTonnes).toBe(7);
    expect(cells[6]).toHaveTextContent(/^2\.33 t\/ha$/);
  });

  it("keeps the single sampled block density unchanged", () => {
    const { trip, cells } = setup();
    expect(trip.summary.sampledAreaHa).toBe(2);
    expect(trip.totalEstimatedTonnes).toBe(5);
    expect(cells[6]).toHaveTextContent(/^2\.5 t\/ha$/);
  });

  it("keeps missing-master density unknown with an unsampled selected block", () => {
    const { trip, cells } = setup({ multiple: true, unsampled: true, weight: null });
    expect(trip.summary.sampledAreaHa).toBe(3);
    expect(trip.totalEstimatedTonnes).toBeNull();
    expect(cells[5]).toHaveTextContent(/^—$/);
    expect(cells[6]).toHaveTextContent(/^—$/);
  });

  it("shows the single sampled block name rather than a numeric count", () => {
    const { cells } = setup();
    expect(cells[4]).toHaveTextContent(/^North Shiraz$/);
  });

  it("shows multiple sampled names, excluding selected but unsampled blocks", () => {
    const { cells } = setup({ multiple: true, unsampled: true });
    expect(cells[4]).toHaveTextContent(/^North Shiraz, South Chardonnay$/);
  });

  it("opens the same trip directly without toggling inline expansion", () => {
    const { row, onOpenTrip } = setup();
    fireEvent.click(within(row).getByRole("button", { name: "View full trip details" }));
    expect(onOpenTrip).toHaveBeenCalledExactlyOnceWith("trip");
    expect(screen.queryByRole("button", { name: /^View full trip detail$/ })).toBeNull();
    fireEvent.click(row);
    fireEvent.click(screen.getByRole("button", { name: /^View full trip detail$/ }));
    expect(onOpenTrip).toHaveBeenNthCalledWith(2, "trip");
    fireEvent.click(within(row).getByRole("button", { name: "View full trip details" }));
    expect(onOpenTrip).toHaveBeenNthCalledWith(3, "trip");
    expect(screen.getByRole("button", { name: /^View full trip detail$/ })).toBeVisible();
  });

  it("applies live damage only when the trip opts in", () => {
    const { trip, cells } = setup({ applyDamage: true });
    expect(trip.totalBaseTonnes).toBe(5);
    expect(trip.totalEstimatedTonnes).toBe(4);
    expect(cells[5]).toHaveTextContent(/^4$/);
    expect(cells[6]).toHaveTextContent(/^2 t\/ha$/);
  });
});