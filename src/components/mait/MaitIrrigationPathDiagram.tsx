import { ArrowDown, Cloud, Cpu, GitBranch, Layers, Eye, RefreshCw, ClipboardList } from 'lucide-react';

const stages = [
  { title: 'Shared MAIT Weather connection', detail: 'One saved connection for weather and irrigation, with getdata access', icon: Cloud },
  { title: 'Confirm MAIT irrigation controller module', detail: 'Confirm a compatible irrigation controller, not a weather or soil sensor module, and link its irrigation system', icon: Cpu },
  { title: 'Output → VineTrack valve', detail: 'Confirm each controller output’s saved valve mapping', icon: GitBranch },
  { title: 'Share water between blocks', detail: 'Use the saved valve coverage', icon: Layers },
  { title: 'Preview MAIT usage — READ-ONLY', detail: 'Compare run timestamps, durations and controller-reported water volumes with MAIT. No irrigation records are created.', icon: Eye },
  { title: 'Confirm retrieval method', detail: 'Review saved output mappings and block coverage before importing.', icon: RefreshCw },
  { title: 'Irrigation Records & Reports', detail: 'Recorded volume attributed using the current saved valve-to-block configuration', icon: ClipboardList },
];
const methods = ['Rows', 'Manual %', 'Emitter count', 'Vine count', 'Irrigated area'];

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
        {index === 5 && <div className="mt-2 space-y-2 text-xs text-muted-foreground">
          <p><strong className="text-foreground">Manual Confirm &amp; Sync</strong> — operational; explicit confirmation can immediately create irrigation records.</p>
          <p className="font-semibold">OR — future optional pilot</p>
          <p><strong className="text-foreground">6-hour auto retrieval</strong> — System Admin pilot only. Scheduler installed but PAUSED; no automatic imports. Automatic record creation (auto commit) is a separate preference requiring approval, not enabled by retrieval alone.</p>
        </div>}
        {index < stages.length - 1 && <ArrowDown className="mt-2 h-4 w-4 text-muted-foreground" aria-hidden="true" />}
      </li>)}
    </ol>
    <p className="mt-4 text-xs text-muted-foreground">Controller-reported water volume is recorded run data, not live flow monitoring. VineTrack does not remotely start, stop or program valves. The pilot scheduler is installed but PAUSED; saving preferences does not activate retrieval or record creation. Compare imported records with MAIT before considering future pilot retrieval.</p>
  </section>;
}