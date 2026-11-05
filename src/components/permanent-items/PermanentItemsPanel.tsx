import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { PERMANENT_ITEM_TYPES, permanentItemTypeLabel, permanentItemsKey, permanentTypesKey, type PermanentItem } from '@/lib/permanentItems';
import { usePermanentItems, usePermanentItemTypes } from './usePermanentItems';
import PermanentTypeSwatch from './PermanentTypeSwatch';
import { pendingPermanentDeleteItems } from '@/lib/permanentItemDeletion';

export default function PermanentItemsPanel({ onSelect }: { onSelect: (item: PermanentItem) => void }) {
  const access = usePermanentItems();
  const { allowed, vineyardId, userId, items, query } = access;
  const catalogue = usePermanentItemTypes(access);
  const qc = useQueryClient();
  const [search, setSearch] = useState('');
  const [type, setType] = useState('all');
  const [status, setStatus] = useState('active');
  if (!allowed) return null;
  const pendingItems = userId && vineyardId ? pendingPermanentDeleteItems(userId, vineyardId) : [];
  const filtered = items.filter(item => (status === 'archived' ? !!item.archived_at : !item.archived_at) && (type === 'all' || item.item_type === type) && `${item.name} ${item.notes ?? ''}`.toLowerCase().includes(search.toLowerCase()));
  return <section className="min-w-0 space-y-3 border-t pt-4" aria-label="Permanent Items list">
    <div className="flex items-center justify-between"><h2 className="text-lg font-semibold">Permanent Items <span className="text-sm font-normal text-muted-foreground">Pilot</span></h2><Button variant="ghost" size="icon" aria-label="Refresh Permanent Items" disabled={query.isFetching} onClick={() => { qc.invalidateQueries({ queryKey: permanentItemsKey(vineyardId, userId) }); qc.invalidateQueries({ queryKey: permanentTypesKey(vineyardId, userId) }); }}><RefreshCw className="h-4 w-4" /></Button></div>
    <div className="grid gap-3 sm:grid-cols-3"><div><Label htmlFor="permanent-search">Search Permanent Items</Label><Input id="permanent-search" value={search} onChange={e => setSearch(e.target.value)} /></div><div><Label htmlFor="permanent-filter">Category / type</Label><Select value={type} onValueChange={setType}><SelectTrigger id="permanent-filter"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">All types</SelectItem>{PERMANENT_ITEM_TYPES.map(t => <SelectItem key={t} value={t}><span className="flex items-center gap-2"><PermanentTypeSwatch />{permanentItemTypeLabel(t)}</span></SelectItem>)}{catalogue.types.map(t => <SelectItem key={t.type_key} value={t.type_key}><span className="flex items-center gap-2"><PermanentTypeSwatch color={t.color_hex} />{t.name}</span></SelectItem>)}</SelectContent></Select></div><div><Label htmlFor="permanent-status">Status</Label><Select value={status} onValueChange={setStatus}><SelectTrigger id="permanent-status"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="active">Active</SelectItem><SelectItem value="archived">Archived</SelectItem></SelectContent></Select></div></div>
    {catalogue.isError && <p role="alert" className="text-destructive">Unable to read vineyard types. Refresh to retry.</p>}
    {query.isLoading && <p role="status">Loading Permanent Items…</p>}
    {query.isError && <p role="alert" className="text-destructive">Unable to read Permanent Items. Refresh to retry.</p>}
    {pendingItems.length > 0 && <div className="space-y-2 border-t pt-3"><h3 className="font-semibold">Pending Permanent Item deletions</h3>{pendingItems.map(item => <Button key={item.id} variant="outline" className="h-auto whitespace-normal" onClick={() => onSelect(item)}>Review pending deletion: {item.name}</Button>)}</div>}
    {!query.isLoading && !query.isError && filtered.length === 0 && <p className="text-sm text-muted-foreground">No Permanent Items match.</p>}
    <ul className="divide-y">{filtered.map(item => <li key={item.id}><Button variant="ghost" className="h-auto w-full justify-start whitespace-normal py-3 text-left" onClick={() => onSelect(item)}><span className="min-w-0 break-words">{item.name}<span className="block text-xs text-muted-foreground"><PermanentTypeSwatch color={catalogue.types.find(t => t.type_key === item.item_type)?.color_hex} /> {permanentItemTypeLabel(item.item_type, catalogue.types)} · {item.latitude}, {item.longitude} · revision {item.server_revision}</span></span></Button></li>)}</ul>
  </section>;
}