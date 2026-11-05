import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { summariseYieldSession } from '@/lib/yieldSessionSummary';
import { buildBunchCountTrips, currentEstimatesByBlock } from '@/lib/bunchCountTrips';
import BunchCountTripsPanel from '@/components/yield/BunchCountTripsPanel';
import { parsePanelMeasurement, summarisePanelMeasurements } from '@/lib/yieldPanelObservations';

vi.mock('@/lib/useRegionFormatters', () => ({ useRegionFormatters: () => ({ areaUnitLabel: 'ha', date: (v: string) => v.slice(0, 10) }) }));
const measurement = { totalBunches: 120, plantedPositions: 10, fruitingVines: 8, missingPositions: 1, nonproductiveVines: 1, panelLengthMetres: 20, calculationVersion: '1' };
const entry = (values = measurement) => ({ measurement: values, recordedAt: '2026-11-05T07:00:00Z', recordedBy: 'worker-1' });
const payload = { countMethod: 'panel', sampleSites: [
  { paddockId: 'a', siteIndex: 1, rowNumber: '12A', panelNumber: 'E-4', panelCountEntry: entry() },
  { paddockId: 'a', siteIndex: 2, panelCountEntry: entry({ ...measurement, totalBunches: 80 }) },
  { paddockId: 'a', siteIndex: 3 },
] };
const blocks = [{ id: 'a', name: 'North', areaHa: 2, vineCount: 1000 }, { id: 'b', name: 'South', vineCount: 500 }];
const options = { blocks, vintageOf: (date: string) => Number(date.slice(0, 4)) };

describe('Panel Count raw history', () => {
  it('sums raw counts and computes ratios from combined denominators, retaining provenance and text references', () => {
    const summary = summariseYieldSession(payload);
    const sites = summary.blocks.flatMap(b => b.sites);
    const totals = summarisePanelMeasurements(sites.map(s => s.panelMeasurement));
    expect(totals).toEqual({ recordedCount: 2, totalBunches: 200, plantedPositions: 20, fruitingVines: 16, missingPositions: 2, nonproductiveVines: 2, panelLengthMetres: 40, bunchesPerPlantedPosition: 10, bunchesPerFruitingVine: 12.5, fruitingRatio: 0.8, missingRatio: 0.1, nonproductiveRatio: 0.1 });
    expect(sites[0]).toMatchObject({ rowNumber: '12A', panelNumber: 'E-4', recordedAt: '2026-11-05T07:00:00Z', recordedBy: 'worker-1' });
    expect(sites[2]?.panelMeasurement).toBeNull();
  });
  it('keeps missing fields and invalid denominators unknown, but accepts genuine recorded zero', () => {
    const incomplete = parsePanelMeasurement({ measurement: { totalBunches: 0, plantedPositions: 0, fruitingVines: null, missingPositions: -1, nonproductiveVines: '0' } });
    const totals = summarisePanelMeasurements([incomplete, null]);
    expect(totals.recordedCount).toBe(1);
    expect(totals.totalBunches).toBe(0);
    expect(totals.fruitingVines).toBeNull();
    expect(totals.missingPositions).toBeNull();
    expect(totals.nonproductiveVines).toBeNull();
    expect(totals.bunchesPerPlantedPosition).toBeNull();
    expect(summarisePanelMeasurements([null]).totalBunches).toBeNull();
  });
  it('never treats a missing total as recorded and accepts serialized panel history', () => {
    const summary = summariseYieldSession(JSON.stringify({ countMethod: 'panel', sampleSites: [{ paddockId: 'a', panelCountEntry: { measurement: { plantedPositions: 10 } } }] }));
    expect(summary.isPanelCount).toBe(true);
    expect(summary.blocks[0]?.recordedCount).toBe(0);
    expect(summary.totalEstTonnes).toBeNull();
  });
  it('keeps raw totals separate for different blocks', () => {
    const summary = summariseYieldSession({ ...payload, sampleSites: [...payload.sampleSites, { paddockId: 'b', panelCountEntry: entry({ ...measurement, totalBunches: 50 }) }] });
    expect(summarisePanelMeasurements(summary.blocks.find(b => b.blockId === 'a')?.sites.map(s => s.panelMeasurement) ?? []).totalBunches).toBe(200);
    expect(summarisePanelMeasurements(summary.blocks.find(b => b.blockId === 'b')?.sites.map(s => s.panelMeasurement) ?? []).totalBunches).toBe(50);
  });
  it('counts panel observations rather than legacy entries and never invents tonnes', () => {
    const summary = summariseYieldSession({ ...payload, blockBunchWeightsKg: { a: 0.2 } }, { blocks });
    const block = summary.blocks[0];
    expect(block?.recordedCount).toBe(2);
    expect(block?.siteCount).toBe(3);
    expect(block?.avgBunchesPerVine).toBeNull();
    expect(summary.totalEstTonnes).toBeNull();
    expect(summary.hasAnySamples).toBe(true);
  });
  it('excludes newer panel sessions even if they contain accidental per-vine entries, per block and vintage', () => {
    const perVine = (id: string, block: string, date: string, countMethod?: string) => ({ id, is_completed: true, completed_at: date, payload: { countMethod, sampleSites: [{ paddockId: block, bunchCountEntry: { bunchesPerVine: 20 } }] } });
    const trips = buildBunchCountTrips([
      perVine('legacy', 'a', '2026-01-01'), perVine('quadrant', 'b', '2026-02-01', 'quadrant'),
      perVine('prior', 'a', '2025-01-01'),
      { id: 'panel', is_completed: true, completed_at: '2026-11-05', payload: { ...payload, sampleSites: payload.sampleSites.map(s => ({ ...s, bunchCountEntry: { bunchesPerVine: 999 } })) } },
    ], options);
    expect(currentEstimatesByBlock(trips, 2026).get('a')?.tripId).toBe('legacy');
    expect(currentEstimatesByBlock(trips, 2026).get('b')?.tripId).toBe('quadrant');
    expect(currentEstimatesByBlock(trips, 2025).get('a')?.tripId).toBe('prior');
    expect(currentEstimatesByBlock(trips.filter(t => t.id === 'panel'), null).size).toBe(0);
  });
  it('displays dated raw totals and skipped sites without offering a panel delete', () => {
    const trips = buildBunchCountTrips([{ id: 'panel', is_completed: true, completed_at: '2026-11-05', payload }], options);
    render(<BunchCountTripsPanel trips={trips} currentEstimates={new Map()} liveTripIds={new Set()} onOpenTrip={vi.fn()} canDelete onDeleteTrip={vi.fn()} />);
    const row = screen.getByTestId('trip-row-panel');
    expect(within(row).getAllByRole('cell')[7]).toHaveTextContent('2');
    fireEvent.click(row);
    expect(screen.getAllByText(/Panel Count/).length).toBeGreaterThan(0);
    expect(screen.getByText('200')).toBeVisible();
    expect(screen.getByText('Not recorded')).toBeVisible();
    expect(screen.queryByTestId('trip-delete-panel')).toBeNull();
  });
});