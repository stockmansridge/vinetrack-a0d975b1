import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Plus } from "lucide-react";
import { ExternalResourceFormDialog } from "@/components/people/ExternalResourcesCard";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import {
  buildResourceGroups, resourceLabel,
  type ExternalResource, type ResourceMember, type ResourceValue,
} from "@/lib/externalResources";

/** Shared grouped picker: Internal resources, then Crew / External contractors. */
export default function ResourcePicker({
  value, onChange, members, externals, vineyardId, memberName, loading, error,
  allowUnassigned = false, allowOther = false, ariaLabel = "Assigned to", emptyLabel = "Unassigned", quickAdd,
}: {
  value: ResourceValue;
  /** `created` is passed when the value comes from a just-created quick-add resource. */
  onChange: (v: ResourceValue, created?: ExternalResource) => void;
  /** Owner/manager quick-add of a crew/contractor; omit to hide the button. */
  quickAdd?: { canManage: boolean; userId: string | null };
  members: ResourceMember[];
  externals: ExternalResource[];
  vineyardId: string;
  memberName: (id: string) => string | null;
  loading?: boolean;
  error?: string | null;
  allowUnassigned?: boolean;
  allowOther?: boolean;
  ariaLabel?: string;
  emptyLabel?: string;
}) {
  const [open, setOpen] = useState(false);
  const [adding, setAdding] = useState(false);
  const groups = buildResourceGroups(members, externals, vineyardId);
  const label = value.kind === "none" ? emptyLabel
    : value.kind === "other" ? (value.text.trim() ? `Other: ${value.text.trim()}` : "Other")
    : resourceLabel(value, memberName, externals);
  const pick = (v: ResourceValue) => { onChange(v); setOpen(false); };
  const inactiveSel = value.kind === "external" && !groups.external.some((r) => r.id === value.id);
  return (
    <div className="space-y-1">
      <div className="flex gap-1">
      <div className="flex-1 min-w-0">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button type="button" variant="outline" role="combobox" aria-expanded={open} aria-label={ariaLabel} className="w-full justify-between font-normal">
            <span className="truncate">{label}</span><span className="text-muted-foreground text-xs">▾</span>
          </Button>
        </PopoverTrigger>
        <PopoverContent className="p-0 w-[--radix-popover-trigger-width]" align="start">
          <Command>
            <CommandInput placeholder="Search people, crews, contractors…" />
            <CommandList>
              {loading ? <div className="py-4 text-center text-sm text-muted-foreground">Loading…</div>
                : error ? <div className="py-4 px-3 text-center text-sm text-destructive">Couldn't load list: {error}</div>
                : <>
                  <CommandEmpty>No matches.</CommandEmpty>
                  {allowUnassigned && <CommandGroup><CommandItem value="__unassigned" onSelect={() => pick({ kind: "none" })}>{emptyLabel}</CommandItem></CommandGroup>}
                  <CommandGroup heading="Internal resources">
                    {groups.internal.map((m) => (
                      <CommandItem key={m.userId} value={`member ${m.name} ${m.email ?? ""} ${m.userId}`} onSelect={() => pick({ kind: "member", userId: m.userId })}>
                        <div className="flex flex-col"><span>{m.name}{value.kind === "member" && value.userId === m.userId ? " ✓" : ""}</span>
                          {m.email && m.email !== m.name && <span className="text-xs text-muted-foreground">{m.email}</span>}</div>
                      </CommandItem>))}
                    {!groups.internal.length && <div className="px-2 py-1.5 text-xs text-muted-foreground">No team members.</div>}
                  </CommandGroup>
                  <CommandGroup heading="Crew / External contractors">
                    {groups.external.map((r) => (
                      <CommandItem key={r.id} value={`external ${r.name} ${r.contact_name ?? ""} ${r.id}`} onSelect={() => pick({ kind: "external", id: r.id })}>
                        <span>{r.name}{value.kind === "external" && value.id === r.id ? " ✓" : ""}</span>
                        <span className="ml-auto text-xs text-muted-foreground">{r.kind === "crew" ? "Crew" : "Contractor"}</span>
                      </CommandItem>))}
                    {!groups.external.length && <div className="px-2 py-1.5 text-xs text-muted-foreground">No active crews or contractors.</div>}
                  </CommandGroup>
                  {allowOther && <CommandGroup><CommandItem value="__other" onSelect={() => pick({ kind: "other", text: value.kind === "other" ? value.text : "" })}>Other (type a name)</CommandItem></CommandGroup>}
                </>}
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
      </div>
      {quickAdd?.canManage && (
        <Button type="button" variant="outline" size="icon" aria-label="Add crew / contractor" title="Add crew / contractor" onClick={() => setAdding(true)}>
          <Plus className="h-4 w-4" />
        </Button>
      )}
      </div>
      {quickAdd?.canManage && (
        <ExternalResourceFormDialog open={adding} onOpenChange={setAdding} vineyardId={vineyardId} userId={quickAdd.userId}
          onSaved={(r) => onChange({ kind: "external", id: r.id }, r)} />
      )}
      {value.kind === "other" && (
        <Input aria-label="Other name" placeholder="Type a name" value={value.text} onChange={(e) => onChange({ kind: "other", text: e.target.value })} />
      )}
      {inactiveSel && <p className="text-xs text-muted-foreground">This crew/contractor is inactive; it stays selected until you change it.</p>}
    </div>
  );
}
