import { useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { toast } from 'sonner';
import { permanentItemsKey, type PermanentItem } from '@/lib/permanentItems';
import { createPermanentDeleteIntent, invokePermanentHardDelete, loadPermanentDeleteIntent, permanentDeleteKey,
  permanentPermissionsKey, PermanentDeleteFailure, persistPermanentDeleteIntent, type PermanentDeleteIntent } from '@/lib/permanentItemDeletion';

export default function PermanentItemHardDelete({ item, userId, disabled, assertAccess, onClose, onBusyChange, onIntentChange }: {
  item: PermanentItem; userId: string; disabled: boolean; assertAccess: () => void; onClose: () => void;
  onBusyChange: (busy: boolean) => void; onIntentChange: (pending: boolean) => void;
}) {
  const qc = useQueryClient();
  const key = permanentDeleteKey(userId, item.vineyard_id, item.id);
  const [recovery] = useState(() => {
    try { return { intent: loadPermanentDeleteIntent(key, item), error: null }; }
    catch (e) { return { intent: null, error: (e as Error).message }; }
  });
  const intent = useRef<PermanentDeleteIntent | null>(recovery.intent);
  const [stage, setStage] = useState(0);
  const [typed, setTyped] = useState('');
  const [error, setError] = useState<string | null>(recovery.error);
  const [pending, setPending] = useState(!!recovery.intent);
  const [blocked, setBlocked] = useState(recovery.intent?.blocked ?? null);
  const [cleanupPending, setCleanupPending] = useState(recovery.intent?.cleanupPending ?? false);
  const mutation = useMutation({ retry: false, mutationFn: async () => {
    assertAccess();
    if (!intent.current) {
      if (stage !== 2 || typed !== 'DELETE') throw new Error('Confirm the item and type DELETE first.');
      intent.current = createPermanentDeleteIntent(userId, item.vineyard_id, item);
    }
    persistPermanentDeleteIntent(key, intent.current);
    setPending(true); onIntentChange(true); onBusyChange(true);
    return invokePermanentHardDelete(intent.current, assertAccess);
  }, onSuccess: async () => {
    localStorage.removeItem(key);
    await qc.invalidateQueries({ queryKey: permanentItemsKey(item.vineyard_id, userId) });
    toast.success('Permanent Item and all photos permanently deleted.');
    onClose();
  }, onError: e => {
    if (intent.current && e instanceof PermanentDeleteFailure) {
      intent.current.cleanupPending = intent.current.cleanupPending || e.cleanupPending;
      intent.current.blocked = e.status === 409 ? 'stale' : e.status === 403 ? 'revoked' : null;
      setCleanupPending(intent.current.cleanupPending); setBlocked(intent.current.blocked);
      try { persistPermanentDeleteIntent(key, intent.current); } catch { /* Original durable intent remains. */ }
      if (e.status === 403) void qc.invalidateQueries({ queryKey: permanentPermissionsKey(item.vineyard_id, userId) });
    }
    setError(e instanceof Error ? e.message : 'Deletion failed. Retry the same operation.');
  }, onSettled: () => onBusyChange(false) });
  return <section className="space-y-3 border-t border-destructive pt-4" aria-label="Permanent Item hard deletion">
    <Button variant="destructive" disabled={disabled || mutation.isPending || pending || !!recovery.error} onClick={() => setStage(1)}><Trash2 className="mr-2 h-4 w-4" />Hard Delete</Button>
    {stage > 0 && !pending && <div className="space-y-3" role="group" aria-label="Confirm permanent deletion">
      <p className="font-semibold text-destructive">Permanently delete “{item.name}”?</p>
      <p className="text-sm">Unlike Archive, Hard Delete permanently removes this item and ALL its photos from iOS, Android and Portal. This cannot be undone.</p>
      {stage === 1 ? <Button variant="destructive" disabled={disabled} onClick={() => setStage(2)}>Continue to final confirmation</Button> : <>
        <Label htmlFor="permanent-delete-confirm">Type DELETE to permanently remove {item.name}</Label>
        <Input id="permanent-delete-confirm" value={typed} onChange={e => setTyped(e.target.value)} autoComplete="off" disabled={disabled} />
        <Button variant="destructive" disabled={disabled || typed !== 'DELETE' || mutation.isPending} onClick={() => mutation.mutate()}>Permanently delete item and all photos</Button>
      </>}
      <Button variant="ghost" disabled={mutation.isPending} onClick={() => { setStage(0); setTyped(''); }}>Cancel hard delete</Button>
    </div>}
    {pending && <p role="status" className="text-sm">{cleanupPending ? 'Item deletion happened; ALL photo cleanup is not yet confirmed.' : 'A deletion request is pending. Retrying preserves the same operation and revision.'}</p>}
    {error && <p role="alert" className="text-destructive break-words">{error}</p>}
    {pending && !blocked && <Button variant="destructive" disabled={disabled || mutation.isPending} onClick={() => mutation.mutate()}>{mutation.isPending ? 'Deleting / cleaning photos…' : 'Retry same deletion operation'}</Button>}
    {blocked && <Button variant="outline" disabled={mutation.isPending} onClick={() => {
      if (blocked === 'stale') localStorage.removeItem(key); // Definitive 409: operator must reopen and explicitly confirm a fresh intent.
      void qc.invalidateQueries({ queryKey: permanentItemsKey(item.vineyard_id, userId) }); onClose();
    }}>Reload list and review</Button>}
  </section>;
}