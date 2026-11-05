import { useEffect } from 'react';
import { permanentItemTypeColor, validPermanentLocation, type PermanentItem } from '@/lib/permanentItems';
import { usePermanentItems, usePermanentItemTypes } from './usePermanentItems';

/** Owns only its own annotations; never participates in pin filtering, counts or map fitting. */
export default function PermanentItemsMapLayer({ map, visible, onSelect }: { map: any; visible: boolean; onSelect?: (item: PermanentItem) => void }) {
  const permanent = usePermanentItems();
  const { allowed, items, query } = permanent;
  const catalogue = usePermanentItemTypes(permanent);
  useEffect(() => {
    const kit = (window as any).mapkit;
    if (!map || !kit || !allowed || !visible || query.isError) return;
    const annotations: any[] = [];
    for (const item of items) {
      if (item.archived_at || !validPermanentLocation(Number(item.latitude), Number(item.longitude))) continue;
      const annotation = new kit.Annotation(new kit.Coordinate(Number(item.latitude), Number(item.longitude)), () => {
        const button = document.createElement('button');
        button.type = 'button'; button.className = 'h-7 w-7 rounded-sm border-2 border-background text-primary-foreground shadow flex items-center justify-center focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring';
        button.style.backgroundColor = permanentItemTypeColor(item.item_type, catalogue.types);
        button.textContent = '◆'; button.setAttribute('aria-label', `Permanent Item: ${item.name}`);
        button.addEventListener('click', event => { event.stopPropagation(); onSelect?.(item); });
        return button;
      }, { title: `Permanent Item: ${item.name}` });
      annotation.addEventListener?.('select', () => onSelect?.(item));
      annotations.push(annotation);
    }
    if (annotations.length) map.addAnnotations(annotations);
    return () => { try { if (annotations.length) map.removeAnnotations(annotations); } catch { /* map destroyed */ } };
  }, [map, visible, allowed, items, query.isError, onSelect, catalogue.types]);
  return null;
}