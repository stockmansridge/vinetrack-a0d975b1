import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { MapPin, LocateFixed, Archive, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import ManualIssuesAppleMap from '@/components/manual-issues/ManualIssuesAppleMap';
import { fetchList } from '@/lib/queries';
import { parsePolygonPoints } from '@/lib/paddockGeometry';
import { guardMutation, readOnlyStore } from '@/lib/vineyardWriteAccess';
import { createPermanentOperation, getPermanentPhoto, PERMANENT_ITEM_TYPES, permanentItemTypeColor, permanentItemTypeLabel, permanentItemsKey, permanentPhotoExtension, PermanentSaveSession, validPermanentLocation, type PermanentItem, type PermanentItemDraft } from '@/lib/permanentItems';
import { usePermanentItemsAccess, usePermanentItemTypes } from './usePermanentItems';
import PermanentTypeDialog from './PermanentTypeDialog';
import PermanentTypeSwatch from './PermanentTypeSwatch';
import PermanentItemHardDelete from './PermanentItemHardDelete';
import { loadPermanentDeleteIntent, permanentDeleteKey } from '@/lib/permanentItemDeletion';

export default function PermanentItemEditor({ item, onClose }: { item: PermanentItem | null; onClose: () => void }) {
  const access = usePermanentItemsAccess();
  const catalogue = usePermanentItemTypes(access);
  const [addingType, setAddingType] = useState(false);
  const readOnly = useSyncExternalStore(readOnlyStore.subscribe, readOnlyStore.get).readOnly;
  const accessRef = useRef(access); accessRef.current = access;
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const qc = useQueryClient();
  const [name, setName] = useState(item?.name ?? '');
  const [type, setType] = useState(item?.item_type ?? 'other');
  const [lat, setLat] = useState(item ? String(item.latitude) : '');
  const [lng, setLng] = useState(item ? String(item.longitude) : '');
  const [paddockId, setPaddockId] = useState(item?.paddock_id ?? 'none');
  const [notes, setNotes] = useState(item?.notes ?? '');
  const [photo, setPhoto] = useState<File | null>(null);
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [synced, setSynced] = useState<PermanentItem | null>(null);
  const [archiveConfirm, setArchiveConfirm] = useState(false);
  const session = useRef<PermanentSaveSession | null>(null);
  const [hasIntent, setHasIntent] = useState(false);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteIntent, setDeleteIntent] = useState(() => {
    if (!item || !access.userId) return false;
    try { return !!loadPermanentDeleteIntent(permanentDeleteKey(access.userId, item.vineyard_id, item.id), item); }
    catch { return true; }
  });
  const scope = useRef({ vineyardId: access.vineyardId, userId: access.userId }).current;
  function assertScope() {
    const current = accessRef.current;
    if (!mounted.current || !current.allowed || current.vineyardId !== scope.vineyardId || current.userId !== scope.userId || (item && item.vineyard_id !== scope.vineyardId)) throw new Error('Pilot access changed. Reopen this item in the selected vineyard.');
    guardMutation(undefined);
  }
  function assertAccess() {
    assertScope();
    if (!accessRef.current.canManage || deleteIntent || deleteBusy) throw new Error('Permanent Item management is unavailable.');
  }
  function assertDeleteAccess() {
    assertScope();
    if (!accessRef.current.canHardDelete || mutation.isPending || hasIntent) throw new Error('Hard Delete is unavailable while access is denied or a save is pending.');
  }
  const blocks = useQuery({ queryKey: ['paddocks', access.vineyardId], enabled: access.allowed, queryFn: () => {
    if (!access.vineyardId) throw new Error('Select a vineyard.');
    return fetchList<{ id: string; name: string | null; polygon_points?: unknown }>('paddocks', access.vineyardId);
  } });
  useEffect(() => {
    let disposed = false; let url: string | null = null;
    if (item && access.allowed) getPermanentPhoto(item).then(value => { url = value; if (disposed && value) URL.revokeObjectURL(value); else setPhotoUrl(value); }).catch(e => !disposed && setError(e.message));
    return () => { disposed = true; if (url) URL.revokeObjectURL(url); };
  }, [item, access.allowed]);
  const mutation = useMutation({ mutationFn: async (action: 'create' | 'update' | 'archive') => {
    assertAccess();
    if (!session.current) {
      if (!scope.vineyardId || !lat.trim() || !lng.trim()) throw new Error('Choose a location or enter latitude and longitude.');
      const draft: PermanentItemDraft = { name, item_type: type, latitude: Number(lat), longitude: Number(lng), paddock_id: paddockId === 'none' ? null : paddockId, notes };
      session.current = new PermanentSaveSession(createPermanentOperation(scope.vineyardId, draft, item, action), action === 'archive' ? null : photo);
      setHasIntent(true);
    }
    return session.current.run(assertAccess);
  }, onSuccess: row => {
    if (!mounted.current) return;
    setSynced(row); setError(null);
    qc.invalidateQueries({ queryKey: permanentItemsKey(scope.vineyardId, scope.userId) });
  }, onError: e => {
    if (!mounted.current) return;
    setError(e instanceof Error ? e.message : 'Save failed. Retry the same operation or reload to review.');
    qc.invalidateQueries({ queryKey: permanentItemsKey(scope.vineyardId, scope.userId) });
  } });
  if (!access.allowed || (!item && !access.canManage) || access.vineyardId !== scope.vineyardId || access.userId !== scope.userId || (item && item.vineyard_id !== access.vineyardId)) return null;
  const busy = mutation.isPending || deleteBusy || addingType;
  const locked = !access.canManage || readOnly || busy || hasIntent || deleteIntent || !!synced || !!item?.archived_at;
  const coordsValid = lat.trim() !== '' && lng.trim() !== '' && validPermanentLocation(Number(lat), Number(lng));
  const pick = (latitude: number, longitude: number) => { if (!locked) { setLat(String(latitude)); setLng(String(longitude)); } };
  return <Dialog open onOpenChange={open => { if (!open && !busy) onClose(); }}>
    <DialogContent className="w-[96vw] max-w-5xl max-h-[92dvh] overflow-y-auto" onInteractOutside={e => busy && e.preventDefault()} onEscapeKeyDown={e => busy && e.preventDefault()}>
      <DialogHeader><DialogTitle>{item ? 'Permanent Item details' : 'Create Permanent Item'}</DialogTitle><DialogDescription>Permanent infrastructure pilot, separate from field Pins.</DialogDescription></DialogHeader>
      {item && <p className="text-xs text-muted-foreground break-all">Revision {item.server_revision} · Created {item.created_at} · Updated {item.updated_at}{item.archived_at ? ` · Archived ${item.archived_at}` : ''}</p>}
      {readOnly && <p role="status" className="text-destructive">This vineyard is read-only.</p>}
      {error && <p role="alert" className="text-destructive break-words">{error}</p>}
      {synced && <p role="status">Synced · revision {synced.server_revision}{synced.archived_at ? ' · Archived' : ''}</p>}
      <div className="grid min-w-0 gap-4 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
      <fieldset disabled={locked} className="grid min-w-0 content-start gap-3 sm:grid-cols-2">
        <div className="space-y-1"><Label htmlFor="permanent-name">Name</Label><Input id="permanent-name" value={name} onChange={e => setName(e.target.value)} /></div>
        <div className="min-w-0 space-y-1"><Label htmlFor="permanent-type">Type</Label><Select value={type} onValueChange={value => setType(value as typeof type)} disabled={locked}><SelectTrigger id="permanent-type"><SelectValue placeholder={permanentItemTypeLabel(type, catalogue.types)} /></SelectTrigger><SelectContent>{PERMANENT_ITEM_TYPES.map(t => <SelectItem key={t} value={t}><span className="flex items-center gap-2"><PermanentTypeSwatch color={permanentItemTypeColor(t)} />{permanentItemTypeLabel(t)}</span></SelectItem>)}{catalogue.types.map(t => <SelectItem key={t.type_key} value={t.type_key}><span className="flex items-center gap-2"><PermanentTypeSwatch color={t.color_hex} />{t.name}</span></SelectItem>)}</SelectContent></Select>
          {access.canManage && !item?.archived_at && <Button type="button" variant="outline" size="sm" disabled={locked} onClick={() => { try { assertAccess(); setAddingType(true); } catch (e) { setError((e as Error).message); } }}><Plus className="mr-1 h-4 w-4" />Add Vineyard Type</Button>}
          {catalogue.isError && <p role="alert" className="text-xs text-destructive">Vineyard types could not be loaded. Reopen to retry.</p>}
        </div>
        <div className="space-y-1"><Label htmlFor="permanent-lat">Latitude</Label><Input id="permanent-lat" inputMode="decimal" value={lat} onChange={e => setLat(e.target.value)} /></div>
        <div className="space-y-1"><Label htmlFor="permanent-lng">Longitude</Label><Input id="permanent-lng" inputMode="decimal" value={lng} onChange={e => setLng(e.target.value)} /></div>
        <div className="space-y-1"><Label htmlFor="permanent-block">Block (optional)</Label><Select value={paddockId} onValueChange={setPaddockId} disabled={locked}><SelectTrigger id="permanent-block"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="none">Not assigned</SelectItem>{blocks.data?.map(b => <SelectItem key={b.id} value={b.id}>{b.name ?? b.id}</SelectItem>)}</SelectContent></Select></div>
        <div className="flex items-end"><Button type="button" variant="outline" disabled={locked} onClick={() => {
          if (!navigator.geolocation) { setError('GPS is unavailable. Enter coordinates or choose on the map.'); return; }
          navigator.geolocation.getCurrentPosition(position => { try { assertAccess(); pick(position.coords.latitude, position.coords.longitude); } catch { /* scope changed */ } }, () => mounted.current && setError('Location unavailable. Enter coordinates or choose on the map.'));
        }}><LocateFixed className="mr-2 h-4 w-4" />Current GPS</Button></div>
        <div className="space-y-1 sm:col-span-2"><Label htmlFor="permanent-notes">Notes</Label><Textarea id="permanent-notes" value={notes} onChange={e => setNotes(e.target.value)} /></div>
        <div className="space-y-1 sm:col-span-2"><Label htmlFor="permanent-photo">Photo (optional, one image, up to 5 MiB)</Label><Input id="permanent-photo" type="file" accept="image/jpeg,image/png,image/webp" onChange={e => {
          const file = e.target.files?.[0] ?? null;
          try { if (file) permanentPhotoExtension(file); setPhoto(file); setError(null); } catch (failure) { e.target.value = ''; setPhoto(null); setError((failure as Error).message); }
        }} /></div>
      </fieldset>
      {photoUrl && <img src={photoUrl} alt={item?.name ?? 'Permanent Item photo'} className="max-h-48 max-w-full object-contain" />}
      <div className="h-64 overflow-hidden rounded-md border" aria-label="Permanent Item location preview"><ManualIssuesAppleMap fitKey={scope.vineyardId ?? ''} polygons={(blocks.data ?? []).map(b => ({ id: b.id, pts: parsePolygonPoints(b.polygon_points) }))} markers={coordsValid ? [{ id: 'preview', lat: Number(lat), lng: Number(lng), colour: 'hsl(var(--primary))', title: name }] : []} onPick={locked ? undefined : pick} /></div>
      {access.canManage && archiveConfirm && !hasIntent && <div role="alert" className="space-y-2 border-t pt-3"><p>Archive this Permanent Item? It will be removed from active markers, not deleted.</p><Button variant="destructive" disabled={locked} onClick={() => mutation.mutate('archive')}>Confirm archive</Button><Button variant="ghost" onClick={() => setArchiveConfirm(false)}>Cancel archive</Button></div>}
      <div className="flex flex-wrap gap-2">
        {access.canManage && !synced && !item?.archived_at && <Button disabled={readOnly || busy || deleteIntent || archiveConfirm && !hasIntent} onClick={() => mutation.mutate(item ? 'update' : 'create')}><MapPin className="mr-2 h-4 w-4" />{mutation.isPending ? 'Saving…' : hasIntent ? 'Retry same operation' : item ? 'Save changes / move marker' : 'Create item'}</Button>}
        {access.canManage && item && !item.archived_at && !hasIntent && <Button variant="outline" disabled={locked} onClick={() => setArchiveConfirm(true)}><Archive className="mr-2 h-4 w-4" />Archive</Button>}
        <Button variant="ghost" disabled={busy} onClick={onClose}>Close</Button>
      </div>
      {hasIntent && !synced && <p className="text-sm text-muted-foreground">This save may already have reached the server. Retry keeps the same operation; closing does not undo it. Reload the list before creating another item.</p>}
      {item && access.userId && access.canHardDelete && <PermanentItemHardDelete item={synced ?? item} userId={access.userId} disabled={readOnly || mutation.isPending || hasIntent || archiveConfirm} assertAccess={assertDeleteAccess} onClose={onClose} onBusyChange={setDeleteBusy} onIntentChange={setDeleteIntent} />}
      {addingType && access.canManage && !readOnly && scope.vineyardId && <PermanentTypeDialog vineyardId={scope.vineyardId} userId={scope.userId} assertAccess={assertAccess} onClose={() => setAddingType(false)} onAdded={row => { assertAccess(); setType(row.type_key); setAddingType(false); }} />}
    </DialogContent>
  </Dialog>;
}