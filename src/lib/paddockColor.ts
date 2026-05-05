// Stable per-paddock colour derived from id.
// hue = hashStable(id) % 360, sat 70%, light 50%.
// See docs/web-portal-map-style.md §2.
function hashStable(s: string): number {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

export function paddockHue(id: string): number {
  return hashStable(id) % 360;
}

export function paddockColor(id: string): string {
  return `hsl(${paddockHue(id)}, 70%, 50%)`;
}
