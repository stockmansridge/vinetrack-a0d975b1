/** Presentation only; unknown methods never become legacy or enter selection logic. */
export function yieldCountMethodLabel(payload: unknown): string {
  let doc = payload;
  if (typeof doc === 'string') { try { doc = JSON.parse(doc); } catch { return 'Count method unavailable'; } }
  const value = doc && typeof doc === 'object' ? (doc as Record<string, unknown>).countMethod : undefined;
  if (value == null || value === '') return 'Bunches Per Vine Count (legacy)';
  if (typeof value !== 'string') return 'Count method unavailable';
  if (value === 'panel') return 'Panel Count';
  return value === 'bunchesPerVine' ? 'Bunches Per Vine Count' : `Count method: ${value}`;
}