import { BaseClient, BaseResponse, fromCustomClient } from './vendor/geotiff.js';
import { retryAfterMs } from './satellite-ingestion-core.ts';
export class Provider429 extends Error { constructor(public retryMs: number) { super('Provider backoff required'); } }
class BytesResponse extends BaseResponse {
  constructor(private code: number, private headers: Headers, private bytes: ArrayBuffer) { super(); }
  override get status() { return this.code; }
  override getHeader(name: string) { return this.headers.get(name) ?? undefined; }
  override async getData() { return this.bytes; }
}
export class RequestBudget {
  requests = 0; transferred = 0;
  constructor(public readonly signal: AbortSignal, public readonly maxRequests = 24, public readonly maxBytes = 16 * 1024 * 1024, public readonly transport: typeof fetch = fetch) {}
}
class BoundedCogClient extends BaseClient {
  constructor(url: string, private budget: RequestBudget) { super(url); }
  override async request(options: RequestInit = {}) {
    if (this.budget.signal.aborted) throw new Error('Raster deadline/cancellation');
    if (++this.budget.requests > this.budget.maxRequests) throw new Error('Provider request ceiling');
    const range = new Headers(options.headers).get('range');
    if (!range || !/^bytes=\d+-\d+$/.test(range)) throw new Error('Single bounded range required');
    const [start, end] = range.slice(6).split('-').map(Number), requested = end - start + 1;
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || requested < 1 || requested > this.budget.maxBytes - this.budget.transferred) throw new Error('Transfer reservation exceeded');
    const res = await this.budget.transport(this.url, { ...options, redirect: 'error', signal: this.budget.signal });
    if (res.status === 429) { await res.body?.cancel(); throw new Provider429(retryAfterMs(res.headers.get('Retry-After')) ?? 60000); }
    const contentRange = /^bytes (\d+)-(\d+)\/\d+$/.exec(res.headers.get('Content-Range') ?? '');
    if (res.status !== 206 || !contentRange || Number(contentRange[1]) !== start || Number(contentRange[2]) > end || !res.body) { await res.body?.cancel(); throw new Error('Unverified COG range response'); }
    const chunks: Uint8Array[] = []; let size = 0;
    const reader = res.body.getReader();
    try {
      while (true) {
        const { done, value } = await reader.read(); if (done) break;
        size += value.byteLength; this.budget.transferred += value.byteLength;
        if (size > requested || this.budget.transferred > this.budget.maxBytes) { await reader.cancel(); throw new Error('Response byte ceiling'); }
        chunks.push(value);
      }
    } finally { reader.releaseLock(); }
    if(size !== Number(contentRange[2])-start+1) throw new Error('Truncated COG range');
    const bytes = new Uint8Array(size); let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
    return new BytesResponse(res.status, res.headers, bytes.buffer);
  }
}
// Never request width/height resampling, overviews or a projected analysis grid.
export async function readExactNativeWindow(url: string, window: number[], budget: RequestBudget) {
  const u = new URL(url);
  if (u.protocol !== 'https:' || u.hostname !== 'sentinel-cogs.s3.us-west-2.amazonaws.com' || u.search || u.hash || !u.pathname.endsWith('.tif')) throw new Error('Unapproved COG source');
  if (window.length !== 4 || window.some((v) => !Number.isInteger(v) || v < 0) || window[2] <= window[0] || window[3] <= window[1] || (window[2]-window[0])*(window[3]-window[1]) > 262144) throw new Error('Native window ceiling');
  const tiff = await fromCustomClient(new BoundedCogClient(url, budget), { allowFullFile: false, maxRanges: 0 }, budget.signal);
  const image = await tiff.getImage();
  if (window[2] > image.getWidth() || window[3] > image.getHeight()) throw new Error('Native window outside tile');
  const origin = image.getOrigin(), resolution = image.getResolution(), keys = image.getGeoKeys();
  const epsg = keys?.ProjectedCSTypeGeoKey;
  if (!epsg || image.getFileDirectory().getValue('ModelTransformation')) throw new Error('Missing native CRS or unsupported rotated source');
  if(image.getTileWidth()*image.getTileHeight()*image.getBytesPerPixel()>4194304 || image.getSamplesPerPixel()!==1) throw new Error('Decoded COG block memory ceiling');
  const data = await image.readRasters({ window, samples: [0], interleave: true, signal: budget.signal });
  return { data, source_grid: { crs: `EPSG:${epsg}`, affine: [resolution[0],0,origin[0],0,resolution[1],origin[1]], width:image.getWidth(),height:image.getHeight() },
    measurement_grid: { crs: `EPSG:${epsg}`, affine: [resolution[0],0,origin[0]+window[0]*resolution[0],0,resolution[1],origin[1]+window[1]*resolution[1]],width:window[2]-window[0],height:window[3]-window[1] },
    no_data: image.getGDALNoData(), window };
}