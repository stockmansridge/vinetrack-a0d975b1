import { Button } from "@/components/ui/button";

export interface SoilBlockOption { id: string; name: string }

/** Shared presentation control; each caller owns its selection and query. */
export function SoilBlockSelector({ blocks, selected, onChange }: {
  blocks: SoilBlockOption[];
  selected: string[];
  onChange: (ids: string[]) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Blocks">
      <span className="text-xs font-medium text-muted-foreground">Blocks:</span>
      {blocks.map((b) => (
        <Button key={b.id} size="sm" aria-pressed={selected.includes(b.id)}
          variant={selected.includes(b.id) ? "default" : "outline"}
          onClick={() => onChange(selected.includes(b.id) ? selected.filter((id) => id !== b.id) : [...selected, b.id])}>
          {b.name}
        </Button>
      ))}
      {blocks.length > 0 ? <>
        <Button size="sm" variant="ghost" onClick={() => onChange(blocks.map((b) => b.id))}>All blocks</Button>
        <Button size="sm" variant="ghost" onClick={() => onChange([])}>Clear</Button>
      </> : <span className="text-sm text-muted-foreground">No blocks for the selected vineyard.</span>}
    </div>
  );
}