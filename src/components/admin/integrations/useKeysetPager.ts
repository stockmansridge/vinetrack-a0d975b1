// Stage 7B — cursor stack for backend keyset pagination (never offsets).
import { useCallback, useState } from "react";
import type { KeysetCursor } from "@/lib/adminIntegrationsQuery";

export function useKeysetPager() {
  const [stack, setStack] = useState<(KeysetCursor | null)[]>([null]);
  const cursor = stack[stack.length - 1] ?? null;
  const page = stack.length - 1;
  const next = useCallback((c: KeysetCursor | null) => {
    if (!c) return;
    setStack((s) => [...s, c]);
  }, []);
  const prev = useCallback(() => setStack((s) => (s.length > 1 ? s.slice(0, -1) : s)), []);
  const reset = useCallback(() => setStack([null]), []);
  return { cursor, page, next, prev, reset };
}
