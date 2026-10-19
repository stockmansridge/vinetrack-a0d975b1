import { insidePolygon, type NativeGrid } from './satellite-ingestion-core.ts';
import proj4 from 'npm:proj4@2.19.10';
export function canonicalRing(raw: unknown): number[][] {
  if (!Array.isArray(raw) || raw.length < 3 || raw.length > 4096) throw new Error('Invalid canonical polygon');
  const ring = raw.map((p) => {
    const x = p?.longitude, y = p?.latitude;
    if (typeof x !== 'number' || typeof y !== 'number' || !Number.isFinite(x + y) || Math.abs(x) > 180 || Math.abs(y) > 90) throw new Error('Invalid canonical vertex');
    return [x, y];
  });
  if (ring[0][0] !== ring.at(-1)?.[0] || ring[0][1] !== ring.at(-1)?.[1]) ring.push([...ring[0]]);
  const orient = (a: number[], b: number[], c: number[]) => (b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]);
  let area = 0;
  for (let i=0;i<ring.length-1;i++) {
    area += ring[i][0]*ring[i+1][1]-ring[i+1][0]*ring[i][1];
    for (let j=i+2;j<ring.length-1;j++) {
      if (i===0 && j===ring.length-2) continue;
      if (orient(ring[i],ring[i+1],ring[j])*orient(ring[i],ring[i+1],ring[j+1])<=0 && orient(ring[j],ring[j+1],ring[i])*orient(ring[j],ring[j+1],ring[i+1])<=0) throw new Error('Self-intersecting boundary');
    }
  }
  if (Math.abs(area)<1e-12) throw new Error('Degenerate boundary');
  return ring;
}
export async function sha256(bytes: Uint8Array): Promise<string> {
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(b=>b.toString(16).padStart(2,'0')).join('');
}
export const hashJson = (value: unknown) => sha256(new TextEncoder().encode(JSON.stringify(value)));
export function projection(crs: string) {
  const epsg = Number(crs.replace('EPSG:','')), zone=epsg%100;
  if (!/^EPSG:32[67]\d\d$/.test(crs) || zone<1 || zone>60) throw new Error('Unsupported UTM CRS');
  return proj4('EPSG:4326', `+proj=utm +zone=${zone} ${epsg>=32700?'+south ':''}+datum=WGS84 +units=m +no_defs`);
}
export function nativeWindow(ring: number[][], source: NativeGrid) {
  const p=projection(source.crs), points=ring.map(v=>p.forward(v));
  const a=source.affine;
  const xs=points.map(v=>(v[0]-a[2])/a[0]), ys=points.map(v=>(v[1]-a[5])/a[4]);
  const window=[Math.floor(Math.min(...xs)),Math.floor(Math.min(...ys)),Math.ceil(Math.max(...xs)),Math.ceil(Math.max(...ys))];
  if (window[0]<0 || window[1]<0 || window[2]>source.width || window[3]>source.height || (window[2]-window[0])*(window[3]-window[1])>65536) throw new Error('Single tile/native window ceiling');
  return { window, projected: points };
}
export function pixelMask(grid: NativeGrid, ring: number[][]) {
  return Array.from({length:grid.width*grid.height},(_,i)=>insidePolygon(grid.affine[2]+(i%grid.width+.5)*grid.affine[0],grid.affine[5]+(Math.floor(i/grid.width)+.5)*grid.affine[4],[ring]));
}