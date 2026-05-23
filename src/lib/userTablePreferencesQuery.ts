import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/context/AuthContext";

const LS_PREFIX = "vt_col_order:";
const TABLE = "user_table_preferences";

function lsKey(userId: string | null, vineyardId: string | null, tableId: string) {
  return `${LS_PREFIX}${userId ?? "anon"}:${vineyardId ?? "global"}:${tableId}`;
}

function reconcile(saved: string[], defaults: string[]): string[] {
  const defaultSet = new Set(defaults);
  // Keep saved order for known columns, append any new defaults at the end.
  const kept = saved.filter((id) => defaultSet.has(id));
  const missing = defaults.filter((id) => !kept.includes(id));
  return [...kept, ...missing];
}

function sameOrder(a: string[], b: string[]) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

export interface UseColumnOrderOptions {
  /** When true, the saved preference is scoped to the supplied vineyardId as well as the user. */
  vineyardId?: string | null;
}

export interface UseColumnOrderResult {
  order: string[];
  setOrder: (next: string[]) => void;
  moveColumn: (fromId: string, beforeId: string | null) => void;
  reset: () => void;
  isLoading: boolean;
}

/**
 * Per-user, per-table column ordering with Supabase persistence and localStorage fallback.
 *
 * - `tableId`: stable id (e.g. "chemicals_table").
 * - `defaultOrder`: stable column ids in their default left→right order. Locked columns
 *   should NOT be passed here — render them outside the reorderable region.
 */
export function useColumnOrder(
  tableId: string,
  defaultOrder: string[],
  options: UseColumnOrderOptions = {},
): UseColumnOrderResult {
  const { user } = useAuth();
  const userId = user?.id ?? null;
  const vineyardId = options.vineyardId ?? null;

  const defaultsRef = useRef(defaultOrder);
  defaultsRef.current = defaultOrder;

  const [order, setOrderState] = useState<string[]>(() => {
    if (typeof window === "undefined") return defaultOrder;
    try {
      const raw = window.localStorage.getItem(lsKey(userId, vineyardId, tableId));
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed) && parsed.every((x) => typeof x === "string")) {
          return reconcile(parsed, defaultOrder);
        }
      }
    } catch {
      /* ignore */
    }
    return defaultOrder;
  });
  const [isLoading, setIsLoading] = useState<boolean>(!!userId);

  // Load from Supabase
  useEffect(() => {
    let cancelled = false;
    if (!userId) {
      setIsLoading(false);
      return;
    }
    setIsLoading(true);
    (async () => {
      let q = supabase
        .from(TABLE as any)
        .select("column_order")
        .eq("user_id", userId)
        .eq("table_id", tableId);
      q = vineyardId ? q.eq("vineyard_id", vineyardId) : q.is("vineyard_id", null);
      const { data, error } = await q.maybeSingle();
      if (cancelled) return;
      setIsLoading(false);
      if (error || !data) return;
      const raw = (data as any).column_order;
      if (Array.isArray(raw) && raw.every((x) => typeof x === "string")) {
        const next = reconcile(raw, defaultsRef.current);
        setOrderState((prev) => (sameOrder(prev, next) ? prev : next));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [userId, vineyardId, tableId]);

  const persist = useCallback(
    (next: string[]) => {
      try {
        window.localStorage.setItem(lsKey(userId, vineyardId, tableId), JSON.stringify(next));
      } catch {
        /* ignore quota */
      }
      if (!userId) return;
      void supabase
        .from(TABLE as any)
        .upsert(
          {
            user_id: userId,
            vineyard_id: vineyardId,
            table_id: tableId,
            column_order: next,
          } as any,
          { onConflict: vineyardId ? "user_id,vineyard_id,table_id" : "user_id,table_id" },
        )
        .then(({ error }) => {
          // Best-effort; surface in console only.
          if (error) console.warn("[useColumnOrder] save failed", error.message);
        });
    },
    [userId, vineyardId, tableId],
  );

  const setOrder = useCallback(
    (next: string[]) => {
      const reconciled = reconcile(next, defaultsRef.current);
      setOrderState((prev) => {
        if (sameOrder(prev, reconciled)) return prev;
        persist(reconciled);
        return reconciled;
      });
    },
    [persist],
  );

  const moveColumn = useCallback(
    (fromId: string, beforeId: string | null) => {
      setOrderState((prev) => {
        if (fromId === beforeId) return prev;
        const without = prev.filter((id) => id !== fromId);
        let insertAt = beforeId == null ? without.length : without.indexOf(beforeId);
        if (insertAt < 0) insertAt = without.length;
        const next = [...without.slice(0, insertAt), fromId, ...without.slice(insertAt)];
        if (sameOrder(prev, next)) return prev;
        persist(next);
        return next;
      });
    },
    [persist],
  );

  const reset = useCallback(() => {
    const next = defaultsRef.current.slice();
    setOrderState(next);
    try {
      window.localStorage.removeItem(lsKey(userId, vineyardId, tableId));
    } catch {
      /* ignore */
    }
    if (userId) {
      let q = supabase.from(TABLE as any).delete().eq("user_id", userId).eq("table_id", tableId);
      q = vineyardId ? q.eq("vineyard_id", vineyardId) : q.is("vineyard_id", null);
      void q.then(({ error }) => {
        if (error) console.warn("[useColumnOrder] reset failed", error.message);
      });
    }
  }, [userId, vineyardId, tableId]);

  return useMemo(
    () => ({ order, setOrder, moveColumn, reset, isLoading }),
    [order, setOrder, moveColumn, reset, isLoading],
  );
}
