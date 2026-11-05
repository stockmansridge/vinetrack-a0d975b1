import { useRef, useState, useSyncExternalStore } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/context/AuthContext';
import { useVineyard } from '@/context/VineyardContext';
import { useDemoMode } from '@/context/DemoModeContext';
import { guardMutation, readOnlyStore } from '@/lib/vineyardWriteAccess';
import { fetchYieldBlocks, type YieldBlockInfo } from '@/lib/yieldReportsQuery';
import {
  canConfirmYieldSites, confirmYieldSiteSet, copyYieldSites, createYieldDraft, deleteYieldDraftSite,
  listYieldSites, listYieldSiteSets, nextYieldDraft, saveYieldSite, siteLocationError, yieldSitesKey,
  type YieldSampleSite, type YieldSiteSet,
} from '@/lib/yieldSampleSites';
import ManualIssuesAppleMap from '@/components/manual-issues/ManualIssuesAppleMap';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Plus, MapPin, Check, Copy, Trash2 } from 'lucide-react';

export default function YieldSampleSitesPanel() {
  const { user, loading: authLoading } = useAuth();
  const { selectedVineyardId, memberships, loading } = useVineyard();
  const { demoMode } = useDemoMode();
  const role = memberships.find(m => m.vineyard_id === selectedVineyardId)?.role ?? null;
  const allowed = !demoMode && !authLoading && !loading && !!user?.id && !!selectedVineyardId && !!role;
  const live = useRef({ allowed, user: user?.id, vineyard: selectedVineyardId, role });
  live.current = { allowed, user: user?.id, vineyard: selectedVineyardId, role };
  const assertAccess = () => {
    const now = live.current;
    if (!now.allowed || now.user !== user?.id || now.vineyard !== selectedVineyardId || now.role !== role) throw new Error('Account or vineyard access changed. Reopen sampling sites.');
    guardMutation(undefined);
  };
  if (!allowed || !selectedVineyardId || !user?.id) return <p role="status" className="text-sm text-muted-foreground">Select an authorised vineyard. Yield sampling sites are unavailable in Demo Mode.</p>;
  return <VineyardSites key={`${user.id}:${selectedVineyardId}:${role}`} vineyard={selectedVineyardId} user={user.id} role={role} assertAccess={assertAccess} />;
}

function VineyardSites({ vineyard, user, role, assertAccess }: { vineyard: string; user: string; role: string; assertAccess: () => void }) {
  const blocks = useQuery({ queryKey: ['yield-site-blocks', vineyard, user], queryFn: () => fetchYieldBlocks(vineyard) });
  const [blockId, setBlockId] = useState('');
  const scope = useRef(blockId);
  scope.current = blockId;
  const assertBlock = () => { assertAccess(); if (scope.current !== blockId) throw new Error('Selected block changed. Reopen sampling sites.'); };
  const block = blocks.data?.find(b => b.id === blockId);
  return <section className="min-w-0 space-y-4">
    <div><h2 className="text-lg font-semibold">Fixed yield sampling sites</h2><p className="text-sm text-muted-foreground">Confirmed locations are kept by block and revision. Survey history and current yield estimates remain unchanged.</p></div>
    <div className="max-w-sm space-y-1"><Label>Block</Label><Select value={blockId} onValueChange={setBlockId}><SelectTrigger aria-label="Sampling block"><SelectValue placeholder="Select block" /></SelectTrigger><SelectContent>{blocks.data?.map(b => <SelectItem key={b.id} value={b.id}>{b.name ?? 'Unnamed block'}</SelectItem>)}</SelectContent></Select></div>
    {blocks.isLoading && <p role="status">Loading blocks…</p>}
    {blocks.error && <ErrorMessage error={blocks.error} />}
    {block && !blocks.isError && <BlockSites key={block.id} block={block} vineyard={vineyard} user={user} role={role} assertAccess={assertBlock} />}
  </section>;
}
function ErrorMessage({ error }: { error: unknown }) { return <p role="alert" className="text-sm text-destructive">{error instanceof Error ? error.message : (error as { message?: string })?.message ?? 'The request failed. Reload before continuing.'}</p>; }

function BlockSites({ block, vineyard, user, role, assertAccess }: { block: YieldBlockInfo; vineyard: string; user: string; role: string; assertAccess: () => void }) {
  const qc = useQueryClient();
  const key = yieldSitesKey(vineyard, user, block.id);
  const sets = useQuery({ queryKey: [...key, 'sets'], queryFn: () => listYieldSiteSets(vineyard, block.id), retry: false });
  const [setId, setSetId] = useState('');
  const selected = sets.data?.find(s => s.id === setId) ?? (setId ? undefined : sets.data?.find(s => s.status === 'confirmed') ?? sets.data?.find(s => s.status === 'draft'));
  const sites = useQuery({ queryKey: [...key, 'sites', selected?.id], enabled: !!selected && !sets.isError, retry: false, queryFn: () => {
    if (!selected) throw new Error('Select a site set.');
    return listYieldSites(selected);
  } });
  const readOnly = useSyncExternalStore(readOnlyStore.subscribe, readOnlyStore.get).readOnly;
  const [name, setName] = useState('Yield sampling sites');
  const [editor, setEditor] = useState<{ site: YieldSampleSite; isNew: boolean } | null>(null);
  const [review, setReview] = useState(false);
  const [blockConfirmed, setBlockConfirmed] = useState(false);
  const [placementError, setPlacementError] = useState<string | null>(null);
  const [placing, setPlacing] = useState(false);
  const pendingDraft = useRef<{ draft: YieldSiteSet; sites: YieldSampleSite[] } | null>(null);
  const polygon = (block.boundary ?? []).map(([lat, lng]) => ({ lat, lng }));
  const refresh = () => qc.invalidateQueries({ queryKey: key });
  const create = useMutation({ mutationFn: async (source: YieldSiteSet | null) => {
    assertAccess();
    if (!pendingDraft.current) {
      const current = await listYieldSiteSets(vineyard, block.id); assertAccess();
      if (source && !current.some(s => s.id === source.id && s.status === 'confirmed')) throw new Error('The confirmed revision changed. Reload.');
      const draft = nextYieldDraft(source, current, vineyard, block.id, user, source?.name ?? name);
      const copied = source ? copyYieldSites(await listYieldSites(source), source, draft) : [];
      pendingDraft.current = { draft, sites: copied };
    }
    return createYieldDraft(pendingDraft.current.draft, pendingDraft.current.sites, assertAccess);
  }, onSuccess: async saved => { pendingDraft.current = null; setSetId(saved.id); setBlockConfirmed(false); await refresh(); }, onError: refresh });
  const confirm = useMutation({ mutationFn: async () => {
    if (!selected) throw new Error('Select a draft.');
    return confirmYieldSiteSet(selected, role, polygon, blockConfirmed, assertAccess);
  }, onSuccess: async () => { setReview(false); await refresh(); }, onError: refresh });
  const busy = create.isPending || confirm.isPending;
  const ready = sets.isSuccess && !sets.isError && !sets.isFetching && (!selected || sites.isSuccess && !sites.isError && !sites.isFetching);
  const locked = readOnly || busy || !ready || !!pendingDraft.current;
  const editable = selected?.status === 'draft' && !locked;
  const markers = (sites.isError ? [] : sites.data ?? []).map(s => ({ id: s.id, lat: s.latitude, lng: s.longitude, colour: 'hsl(var(--primary))', title: `${s.site_number}. ${s.name}` }));
  const openSite = (site: YieldSampleSite) => { setEditor({ site, isNew: false }); setPlacing(false); };
  const add = (latitude = NaN, longitude = NaN) => {
    if (!selected || !editable) return;
    const number = Math.max(0, ...(sites.data ?? []).map(s => s.site_number)) + 1;
    setEditor({ isNew: true, site: { id: crypto.randomUUID(), site_id: crypto.randomUUID(), site_set_id: selected.id, vineyard_id: vineyard, paddock_id: block.id, site_number: number, name: `Site ${number}`, latitude, longitude, row_number: null, panel_number: null, notes: null } });
    setPlacing(false);
  };
  return <div className="space-y-4 min-w-0">
    {readOnly && <p role="status">This vineyard is read-only.</p>}
    {sets.isLoading && <p role="status">Loading site sets…</p>}{sets.error && <ErrorMessage error={sets.error} />}
    <div className="flex flex-wrap items-end gap-2">
      <div className="space-y-1"><Label htmlFor="site-set-name">New set name</Label><Input id="site-set-name" value={name} disabled={locked} onChange={e => setName(e.target.value)} /></div>
      <Button disabled={locked || !name.trim()} onClick={() => create.mutate(null)}><Plus className="mr-2 h-4 w-4" />New draft set</Button>
      {selected?.status === 'confirmed' && <Button variant="outline" disabled={locked} onClick={() => create.mutate(selected)}><Copy className="mr-2 h-4 w-4" />Start next revision</Button>}
      {pendingDraft.current && <Button disabled={busy || readOnly} onClick={() => create.mutate(null)}>Retry same draft</Button>}
      <Button variant="outline" disabled={busy} onClick={() => refresh()}>Reload</Button>
    </div>
    {create.error && <ErrorMessage error={create.error} />}{confirm.error && <ErrorMessage error={confirm.error} />}
    {!!sets.data?.length && <div className="max-w-lg space-y-1"><Label>Site set / revision</Label><Select value={selected?.id ?? ''} disabled={busy || !!pendingDraft.current} onValueChange={id => { setSetId(id); setEditor(null); setReview(false); setPlacing(false); setBlockConfirmed(false); setPlacementError(null); }}><SelectTrigger aria-label="Site set revision"><SelectValue /></SelectTrigger><SelectContent>{sets.data.map(s => <SelectItem key={s.id} value={s.id}>{s.name} · v{s.version} · {s.status}</SelectItem>)}</SelectContent></Select></div>}
    {selected && <>
      <div className="flex flex-wrap items-center gap-2"><Badge variant="outline">{selected.status} · v{selected.version}</Badge><span className="text-sm">{sites.data?.length ?? 0} saved sites · {block.name}</span>{selected.confirmed_at && <span className="text-xs text-muted-foreground">Confirmed {new Date(selected.confirmed_at).toLocaleString()}</span>}</div>
      {selected.status !== 'draft' && <p className="text-sm text-muted-foreground">This revision is read-only. Stable site identities and previous survey observations are retained.</p>}
      {sites.isLoading && <p role="status">Loading sites…</p>}{sites.error && <ErrorMessage error={sites.error} />}
      {polygon.length < 3 && <div className="flex items-center gap-2 text-sm"><Checkbox id="confirm-sampling-block" disabled={locked} checked={blockConfirmed} onCheckedChange={v => setBlockConfirmed(v === true)} /><Label htmlFor="confirm-sampling-block">No block boundary available — I confirm these locations belong to {block.name ?? 'this block'}.</Label></div>}
      <div className="flex flex-wrap gap-2">
        {selected.status === 'draft' && <><Button variant={placing ? 'secondary' : 'outline'} disabled={!editable || polygon.length < 3} aria-pressed={placing} onClick={() => setPlacing(v => !v)}><MapPin className="mr-2 h-4 w-4" />{placing ? 'Cancel placement' : 'Place site on map'}</Button><Button variant="outline" disabled={!editable} onClick={() => add()}><Plus className="mr-2 h-4 w-4" />Add site coordinates</Button></>}
        {selected.status === 'draft' && canConfirmYieldSites(role) && <Button disabled={locked || !sites.data?.length || polygon.length < 3 && !blockConfirmed} onClick={() => setReview(true)}><Check className="mr-2 h-4 w-4" />Review & confirm block</Button>}
      </div>
      {placementError && <p role="alert" className="text-sm text-destructive">{placementError}</p>}
      <div className="grid min-w-0 gap-4 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
        <ManualIssuesAppleMap className="h-[380px] min-w-0 rounded-md overflow-hidden" fitKey={block.id} markers={markers} polygons={polygon.length >= 3 ? [{ id: block.id, pts: polygon }] : []} onSelect={id => { const s = sites.data?.find(s => s.id === id); if (s) openSite(s); }} onPick={placing && editable ? (lat, lng) => { const error = siteLocationError({ lat, lng }, polygon, blockConfirmed); setPlacementError(error); if (!error) add(lat, lng); } : undefined} />
        <div className="min-w-0 max-h-[380px] overflow-auto divide-y border-y">
          {(sites.isError ? [] : sites.data ?? []).map(s => <Button key={s.id} variant="ghost" className="h-auto w-full justify-start rounded-none px-2 py-3 text-left whitespace-normal" onClick={() => openSite(s)}><div className="min-w-0"><div className="font-medium">{s.site_number}. {s.name}</div><div className="text-xs text-muted-foreground">{s.latitude}, {s.longitude} · Row {s.row_number ?? '—'} / panel {s.panel_number ?? '—'}</div></div></Button>)}
          {sites.isSuccess && !sites.data?.length && <p className="p-3 text-sm text-muted-foreground">No saved locations in this revision.</p>}
        </div>
      </div>
      {editor && <SiteEditor key={editor.site.id} set={selected} site={editor.site} isNew={editor.isNew} editable={!!editable} polygon={polygon} blockConfirmed={blockConfirmed} assertAccess={assertAccess} onClose={() => { setEditor(null); refresh(); }} onSaved={refresh} />}
      <Dialog open={review} onOpenChange={open => { if (!confirm.isPending) setReview(open); }}><DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto"><DialogHeader><DialogTitle>Confirm sites for {block.name}</DialogTitle><DialogDescription>Confirm only this block, revision {selected.version}. Sites become read-only and any previous confirmed set for this block is archived atomically. Survey history is retained.</DialogDescription></DialogHeader>
        <ul className="space-y-2 text-sm">{sites.data?.map(s => <li key={s.id}>{s.site_number}. {s.name} — {s.latitude}, {s.longitude} · Row {s.row_number ?? '—'}, panel {s.panel_number ?? '—'}</li>)}</ul>
        {confirm.error && <ErrorMessage error={confirm.error} />}
        <div className="flex gap-2"><Button disabled={locked || !canConfirmYieldSites(role)} onClick={() => confirm.mutate()}>{confirm.isPending ? 'Confirming…' : 'Confirm this block'}</Button><Button variant="outline" disabled={confirm.isPending} onClick={() => setReview(false)}>Cancel</Button></div>
      </DialogContent></Dialog>
    </>}
  </div>;
}
function SiteEditor({ set, site, isNew, editable, polygon, blockConfirmed, assertAccess, onClose, onSaved }: { set: YieldSiteSet; site: YieldSampleSite; isNew: boolean; editable: boolean; polygon: { lat: number; lng: number }[]; blockConfirmed: boolean; assertAccess: () => void; onClose: () => void; onSaved: () => Promise<unknown> }) {
  const [name, setName] = useState(site.name), [number, setNumber] = useState(String(site.site_number));
  const [lat, setLat] = useState(Number.isFinite(site.latitude) ? String(site.latitude) : ''), [lng, setLng] = useState(Number.isFinite(site.longitude) ? String(site.longitude) : '');
  const [row, setRow] = useState(site.row_number == null ? '' : String(site.row_number)), [panel, setPanel] = useState(site.panel_number == null ? '' : String(site.panel_number));
  const [notes, setNotes] = useState(site.notes ?? ''), [remove, setRemove] = useState(false);
  const save = useMutation({ mutationFn: () => {
    if (!editable) throw new Error('This revision is read-only.');
    return saveYieldSite(set, { ...site, name: name.trim(), site_number: number.trim() ? Number(number) : NaN, latitude: lat.trim() ? Number(lat) : NaN, longitude: lng.trim() ? Number(lng) : NaN, row_number: row.trim() ? Number(row) : null, panel_number: panel.trim() ? Number(panel) : null, notes: notes || null }, isNew, polygon, blockConfirmed, assertAccess);
  }, onSuccess: async () => { await onSaved(); onClose(); } });
  const deletion = useMutation({ mutationFn: () => { if (!editable) throw new Error('This revision is read-only.'); return deleteYieldDraftSite(set, site, assertAccess); }, onSuccess: async () => { await onSaved(); onClose(); } });
  const busy = save.isPending || deletion.isPending;
  const locked = !editable || busy;
  return <Dialog open onOpenChange={o => { if (!o && !busy) onClose(); }}><DialogContent className="max-w-xl max-h-[85vh] overflow-y-auto"><DialogHeader><DialogTitle>{isNew ? 'New sampling site' : site.name}</DialogTitle><DialogDescription>{set.status === 'draft' ? 'Draft location — saved only for this block revision.' : 'Confirmed and archived locations cannot be edited.'}</DialogDescription></DialogHeader>
    <div className="grid grid-cols-2 gap-3">{[
      ['Name', name, setName, 'text'], ['Site number', number, setNumber, 'number'], ['Latitude', lat, setLat, 'number'], ['Longitude', lng, setLng, 'number'], ['Row (optional)', row, setRow, 'number'], ['Panel (optional)', panel, setPanel, 'number'],
    ].map(([label, value, update, type]) => <div key={String(label)} className="space-y-1"><Label htmlFor={`yield-site-${label}`}>{String(label)}</Label><Input id={`yield-site-${label}`} type={String(type)} step="any" disabled={locked} value={String(value)} onChange={e => { if (typeof update === 'function') update(e.target.value); }} /></div>)}</div>
    <Label htmlFor="yield-site-notes">Note (optional)</Label><Textarea id="yield-site-notes" disabled={locked} value={notes} onChange={e => setNotes(e.target.value)} rows={3} />
    <p className="text-xs text-muted-foreground break-all">Physical site ID: {site.site_id}</p>
    {save.error && <ErrorMessage error={save.error} />}{deletion.error && <ErrorMessage error={deletion.error} />}
    <div className="flex flex-wrap gap-2">{editable && <Button disabled={busy} onClick={() => save.mutate()}>{save.isPending ? 'Saving…' : 'Save site'}</Button>}<Button variant="outline" disabled={busy} onClick={onClose}>Close</Button>{editable && !isNew && <Button variant="destructive" disabled={busy} onClick={() => setRemove(true)}><Trash2 className="mr-2 h-4 w-4" />Delete draft site</Button>}</div>
    {remove && <div className="space-y-2 border-t pt-3"><p>Delete {site.name} from this draft only?</p><Button variant="destructive" disabled={locked} onClick={() => deletion.mutate()}>Confirm draft deletion</Button><Button variant="outline" disabled={busy} onClick={() => setRemove(false)}>Cancel</Button></div>}
  </DialogContent></Dialog>;
}