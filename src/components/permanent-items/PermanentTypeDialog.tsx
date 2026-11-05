import { useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { createPermanentType, permanentTypesKey, type PermanentVineyardType } from '@/lib/permanentItems';
import PermanentTypeSwatch from './PermanentTypeSwatch';

// These are operator-selectable catalogue colours, not interface theme colours.
const PALETTE = ['#25803D', '#2478C4', '#D64A42', '#E0A125', '#8C52B4', '#C44183', '#238C8B', '#626B73'];
export default function PermanentTypeDialog({ vineyardId, userId, assertAccess, onAdded, onClose }: {
  vineyardId: string; userId?: string; assertAccess: () => void; onAdded: (row: PermanentVineyardType) => void; onClose: () => void;
}) {
  const [name, setName] = useState('');
  const [color, setColor] = useState(PALETTE[0]);
  const [error, setError] = useState<string | null>(null);
  const inFlight = useRef(false);
  const qc = useQueryClient();
  const mutation = useMutation({ mutationFn: async () => {
    if (inFlight.current) throw new Error('A type save is already in progress.');
    inFlight.current = true;
    try { return await createPermanentType(vineyardId, name, color, assertAccess); }
    finally { inFlight.current = false; }
  }, onSuccess: row => {
    try {
      assertAccess();
      qc.setQueryData<PermanentVineyardType[]>(permanentTypesKey(vineyardId, userId), old => [...(old ?? []).filter(t => t.type_key !== row.type_key), row]);
      onAdded(row);
    } catch (e) { setError(e instanceof Error ? e.message : 'Access changed. Reopen the selected vineyard.'); }
    qc.invalidateQueries({ queryKey: ['permanent-item-types', vineyardId] });
  }, onError: e => {
    setError(e instanceof Error ? e.message : (e as { message?: string })?.message ?? 'Type save failed. Refresh before retrying an uncertain save.');
    qc.invalidateQueries({ queryKey: ['permanent-item-types', vineyardId] });
  } });
  return <Dialog open onOpenChange={open => { if (!open && !mutation.isPending) onClose(); }}>
    <DialogContent className="max-w-md max-h-[90dvh] overflow-y-auto" onInteractOutside={e => mutation.isPending && e.preventDefault()} onEscapeKeyDown={e => mutation.isPending && e.preventDefault()}>
      <DialogHeader><DialogTitle>Add Vineyard Type</DialogTitle><DialogDescription>A shared Permanent Pin type for this vineyard.</DialogDescription></DialogHeader>
      <form className="min-w-0 space-y-4" onSubmit={e => { e.preventDefault(); if (!inFlight.current && !mutation.isPending) { setError(null); mutation.mutate(); } }}>
        <div className="space-y-1"><Label htmlFor="permanent-custom-name">Type name</Label><Input id="permanent-custom-name" autoFocus maxLength={60} value={name} disabled={mutation.isPending} onChange={e => setName(e.target.value)} /></div>
        <div className="space-y-2"><Label htmlFor="permanent-custom-color">Pin colour</Label><div className="flex gap-2"><Input id="permanent-custom-color" type="color" className="w-14 shrink-0 p-1" value={/^#[0-9a-fA-F]{6}$/.test(color) ? color : PALETTE[0]} disabled={mutation.isPending} onChange={e => setColor(e.target.value)} /><Input aria-label="Colour hex" value={color} maxLength={7} disabled={mutation.isPending} onChange={e => setColor(e.target.value)} /></div>
          <div className="flex flex-wrap gap-1">{PALETTE.map(c => <Button key={c} type="button" variant="outline" size="icon" aria-label={`Choose colour ${c}`} aria-pressed={color.toLowerCase() === c.toLowerCase()} disabled={mutation.isPending} onClick={() => setColor(c)}><PermanentTypeSwatch color={c} /></Button>)}</div>
        </div>
        {error && <p role="alert" className="text-sm text-destructive break-words">{error}</p>}
        <div className="flex gap-2"><Button type="submit" disabled={mutation.isPending || !name.trim() || !/^#[0-9a-fA-F]{6}$/.test(color)}>{mutation.isPending ? 'Adding…' : 'Add Type'}</Button><Button type="button" variant="ghost" disabled={mutation.isPending} onClick={onClose}>Cancel</Button></div>
      </form>
    </DialogContent>
  </Dialog>;
}