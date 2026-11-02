import { ArrowDown, Cloud, Cpu, GitBranch, Layers, RefreshCw, ClipboardList } from 'lucide-react';

const stages = [
  { title: 'Weather connection', detail: 'One saved MAIT connection with getdata access', icon: Cloud },
  { title: 'MAIT controller module', detail: 'Choose a compatible controller and irrigation system', icon: Cpu },
  { title: 'Output → VineTrack valve', detail: 'Confirm each controller output’s saved valve mapping', icon: GitBranch },
  { title: 'Share water between blocks', detail: 'Use the saved valve coverage', icon: Layers },
  { title: 'Retrieve recorded runs', detail: 'Manual Sync now is operational. Planned scheduled sync: pilot only, not yet running.', icon: RefreshCw },
  { title: 'Irrigation Records & Reports', detail: 'Recorded volume attributed using the current saved valve-to-block configuration', icon: ClipboardList },
];
const methods = ['Rows', 'Manual percentage', 'Emitter count', 'Vine count', 'Irrigated area'];

/** Source-editable, presentation-only diagram; never drives controller configuration. */
export function MaitIrrigationPathDiagram() {
  return <section aria-label="MAIT irrigation path" className="min-w-0 border-t bg-background p-4 sm:p-6">
    <h3 className="text-base font-semibold">MAIT connection to irrigation records</h3>
    <ol className="mt-4 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
      {stages.map(({ title, detail, icon: Icon }, index) => <li key={title} className="min-w-0 border-l-2 border-task-water pl-4">
        <div className="flex items-center gap-2 text-task-water"><Icon className="h-5 w-5 shrink-0" aria-hidden="true" /><span className="text-xs font-semibold">{index + 1}</span></div>
        <h4 className="mt-2 text-sm font-semibold">{title}</h4>
        <p className="mt-1 text-sm text-muted-foreground">{detail}</p>
        {index === 3 && <ul className="mt-2 flex flex-wrap gap-2">{methods.map(method => <li key={method} className="rounded border border-border bg-muted px-2 py-1 text-xs">{method}</li>)}</ul>}
        {index < stages.length - 1 && <ArrowDown className="mt-2 h-4 w-4 text-muted-foreground" aria-hidden="true" />}
      </li>)}
    </ol>
    <p className="mt-4 text-xs text-muted-foreground">Controller-reported water volume is recorded run data, not live flow monitoring. VineTrack does not remotely start, stop or program valves. Automatic retrieval and record creation are System Admin pilot preferences; the scheduler is inactive.</p>
  </section>;
}