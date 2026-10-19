import { expect, it } from 'vitest';
import { historicalTimelineStatus, hasLiveLease } from './cropHealthActivity';
import { retryAfterMs, validateNativeGrid, processNativePixels, insidePolygon, validScl, PILOT_VINEYARD, validateExactManifest, type ExactManifest } from '../../supabase/functions/_shared/satellite-ingestion-core';
import { exactEarthSearchItem, requireAlignedScl, sampleSclNearest } from '../../supabase/functions/_shared/satellite-exact-adapter';
const grid = { crs: 'EPSG:32755', affine: [10,0,600000,0,-10,6300000], width: 2, height: 2 };
it.each(['pending','processing','downloaded','available','retry_pending'])('legacy %s never proves active processing', (s) => expect(historicalTimelineStatus(s)).toBe('queued'));
it('only a current fenced lease with recent heartbeat is active', () => {
  const now = Date.parse('2026-10-19T05:00:00Z');
  expect(hasLiveLease({ status:'leased', heartbeat_at:'2026-10-19T04:59:30Z',lease_expires_at:'2026-10-19T05:01:00Z' },now)).toBe(true);
  expect(hasLiveLease({ status:'processing', heartbeat_at:'2026-08-02',lease_expires_at:'2026-10-19T05:01:00Z' },now)).toBe(false);
  expect(hasLiveLease({ status:'leased', heartbeat_at:'2026-10-19T04:58:00Z',lease_expires_at:'2026-10-19T05:01:00Z' },now)).toBe(false);
  expect(hasLiveLease({ status:'leased', heartbeat_at:'2026-10-19T05:00:00Z',lease_expires_at:'2026-10-19T05:00:00Z' },now)).toBe(false);
});
it('CDSE numeric Retry-After is milliseconds, not seconds', () => expect(retryAfterMs('1500')).toBe(1500));
it('HTTP-date Retry-After, cap, missing and invalid values', () => {
  expect(retryAfterMs('Mon, 19 Oct 2026 05:00:02 GMT',Date.parse('2026-10-19T05:00:00Z'))).toBe(2000);
  expect(retryAfterMs('999999999999')).toBe(86400000);
  for (const s of [null,'','-1','NaN','nonsense']) expect(retryAfterMs(s)).toBeNull();
});
it('native grid rejects Web Mercator, 20m, rotation and huge dimensions', () => {
  validateNativeGrid(grid);
  for (const g of [{...grid,crs:'EPSG:3857'},{...grid,affine:[20,0,0,0,-20,0]},{...grid,affine:[10,1,0,0,-10,0]},{...grid,width:10000,height:10000}]) expect(()=>validateNativeGrid(g)).toThrow();
});
it('NDVI golden fixture applies baseline offset and identical native valid pixels for statistics', () => {
  const result = processNativePixels({grid,layer:'NDVI',red:[2000,2000,2000,0],nir:[4000,4000,4000,0],scl:[4,9,4,4],inside:[true,true,false,true],scales:{red:{scale:.0001,offset:-.1},nir:{scale:.0001,offset:-.1}},noData:0});
  expect(result.analytical[0]).toBeCloseTo(.5,6); expect(result.analytical[1]).toBe(-9999);
  expect(result.summary?.mean_value).toBeCloseTo(.5,6); expect(result.summary?.valid_pixel_count).toBe(1);
  expect(result.cloud_percent).toBeCloseTo(100/3,6); expect(result.valid_coverage_percent).toBeCloseTo(100/3,6);
});
it('True Colour golden fixture is visual only and transparent outside/masked pixels', () => {
  const r=processNativePixels({grid,layer:'TRUE_COLOUR',red:[3000,3000,3000,3000],green:[1500,1500,1500,1500],blue:[0,0,0,0],scl:[4,3,4,4],inside:[true,true,false,true],scales:{red:{scale:.0001,offset:0},green:{scale:.0001,offset:0},blue:{scale:.0001,offset:0}},noData:-9999});
  expect(Array.from(r.rgba.slice(0,4))).toEqual([255,128,0,255]); expect(r.rgba[7]).toBe(0); expect(r.rgba[11]).toBe(0); expect(r.summary).toBeNull();
});
it('holes and cloud/shadow/snow/no-data are excluded', () => {
  const rings=[[[0,0],[10,0],[10,10],[0,10]],[[4,4],[6,4],[6,6],[4,6]]];
  expect(insidePolygon(2,2,rings)).toBe(true); expect(insidePolygon(5,5,rings)).toBe(false);
  for(const s of [0,1,2,3,7,8,9,10,11]) expect(validScl(s)).toBe(false);
});
it('rejects missing calibration and unaligned SCL; records nearest categorical mask sampling', () => {
  expect(()=>exactEarthSearchItem({id:'item',collection:'s2',properties:{datetime:'2026-08-01', 's2:processing_baseline':'04.00'},assets:{}})).toThrow();
  requireAlignedScl(grid,{crs:grid.crs,affine:[20,0,600000,0,-20,6300000]});
  expect(()=>requireAlignedScl(grid,{crs:grid.crs,affine:[20,0,600001,0,-20,6300000]})).toThrow();
  expect(sampleSclNearest(600005,6299995,{affine:[20,0,600000,0,-20,6300000],width:1,height:1,values:[4]})).toBe(4);
});
it('source proof rejects mismatched item, unapproved host and missing baseline', () => {
  const asset={item_id:'one',href:'https://sentinel-cogs.s3.us-west-2.amazonaws.com/one/B04.tif',scale:.0001,offset:-.1,resolution:10};
  const m:ExactManifest={schema_version:1,item_id:'one',collection:'sentinel-2-l2a',acquired_at:'2026-08-01',baseline:'04.00',cloud_mask_method:'SCL',bands:{red:asset,nir:asset,scl:{...asset,resolution:20}}};
  validateExactManifest(m,'NDVI');
  expect(()=>validateExactManifest({...m,bands:{...m.bands,nir:{...asset,item_id:'other'}}},'NDVI')).toThrow();
  expect(()=>validateExactManifest({...m,baseline:''},'NDVI')).toThrow();
  expect(()=>validateExactManifest({...m,bands:{...m.bands,red:{...asset,href:'https://evil.invalid/x.tif'}}},'NDVI')).toThrow();
  expect(PILOT_VINEYARD).toBe('fe952afe-437f-4be7-8cbf-fdd8e630411c');
});