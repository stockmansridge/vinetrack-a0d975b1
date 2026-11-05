import type { SessionBlockSummary } from '@/lib/yieldSessionSummary';
import { summarisePanelMeasurements } from '@/lib/yieldPanelObservations';
import { useRegionFormatters } from '@/lib/useRegionFormatters';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

const number = (n: number | null) => n == null ? '—' : n.toLocaleString(undefined, { maximumFractionDigits: 2 });
const percentage = (n: number | null) => n == null ? '—' : `${number(n * 100)}%`;
export default function PanelCountObservations({ blocks }: { blocks: SessionBlockSummary[] }) {
  const rf = useRegionFormatters();
  const totals = summarisePanelMeasurements(blocks.flatMap(b => b.sites.map(s => s.panelMeasurement)));
  const metrics = (m: ReturnType<typeof summarisePanelMeasurements>) => [
    ['Total bunches', number(m.totalBunches)], ['Planted positions', number(m.plantedPositions)],
    ['Fruiting vines', number(m.fruitingVines)], ['Missing positions', number(m.missingPositions)],
    ['Nonproductive vines', number(m.nonproductiveVines)], ['Panel length (m)', number(m.panelLengthMetres)],
    ['Bunches / planted position', number(m.bunchesPerPlantedPosition)], ['Bunches / fruiting vine', number(m.bunchesPerFruitingVine)],
    ['Fruiting / planted', percentage(m.fruitingRatio)], ['Missing / planted', percentage(m.missingRatio)],
    ['Nonproductive / planted', percentage(m.nonproductiveRatio)],
  ];
  const fields = (m: ReturnType<typeof summarisePanelMeasurements>) => <dl className="grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-3">{metrics(m).map(([label, value]) => <div key={label}><dt className="text-muted-foreground">{label}</dt><dd className="tabular-nums font-medium">{value}</dd></div>)}</dl>;
  return <div className="space-y-4 text-xs">
    <p className="text-muted-foreground">Panel Count · Raw observations only. Not an automatic current estimate source; no tonnage calculated. Skipped sites are not zero counts.</p>
    {fields(totals)}
    {blocks.map((b, i) => <section key={b.blockId ?? i} className="space-y-2 border-t pt-3">
      <h4 className="font-medium">{b.blockName ?? 'Unnamed block'} · {b.recordedCount} / {b.siteCount} recorded panels</h4>
      {blocks.length > 1 && fields(summarisePanelMeasurements(b.sites.map(s => s.panelMeasurement)))}
      <div className="overflow-x-auto"><Table><TableHeader><TableRow>
        {['Site', 'Row / panel', 'Bunches', 'Planted', 'Fruiting', 'Missing', 'Nonproductive', 'Length (m)', 'Version', 'Recorded', 'By'].map(h => <TableHead key={h}>{h}</TableHead>)}
      </TableRow></TableHeader><TableBody>{b.sites.map((s, index) => <TableRow key={index}>
        <TableCell>{s.siteIndex ?? index + 1}</TableCell><TableCell>{s.rowNumber ?? '—'} / {s.panelNumber ?? '—'}</TableCell>
        <TableCell>{s.panelMeasurement?.totalBunches != null ? number(s.panelMeasurement.totalBunches) : 'Not recorded'}</TableCell>
        {(['plantedPositions', 'fruitingVines', 'missingPositions', 'nonproductiveVines', 'panelLengthMetres'] as const).map(k => <TableCell key={k}>{number(s.panelMeasurement?.[k] ?? null)}</TableCell>)}
        <TableCell>{s.panelMeasurement?.calculationVersion ?? '—'}</TableCell>
        <TableCell className="whitespace-nowrap">{s.recordedAt ? rf.date(s.recordedAt) : '—'}</TableCell><TableCell>{s.recordedBy ?? '—'}</TableCell>
      </TableRow>)}</TableBody></Table></div>
    </section>)}
  </div>;
}