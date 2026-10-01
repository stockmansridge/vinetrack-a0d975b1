// Generation guard for selected-Master hydration. Only the request started by
// the still-current selection may apply its result; any newer selection,
// staged/manual switch, Back, or dialog close invalidates older requests.
export interface HydrationGate {
  begin(): number;
  isCurrent(token: number): boolean;
  invalidate(): void;
}

export function createHydrationGate(): HydrationGate {
  let generation = 0;
  return {
    begin: () => ++generation,
    isCurrent: (token) => token === generation,
    invalidate: () => {
      generation++;
    },
  };
}
