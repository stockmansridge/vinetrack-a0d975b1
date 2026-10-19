// Synthetic in-memory fixture ONLY. No catalogue, storage or provider requests.
// @deno-types="./vendor/geotiff.d.ts"
import { writeArrayBuffer } from './vendor/geotiff.js';
import { renderPilot } from './satellite-pilot-raster.ts';
import { RequestBudget } from './satellite-bounded-cog.ts';
import { projection } from './satellite-pilot-geometry.ts';
import type { ExactManifest } from './satellite-ingestion-core.ts';
export function pilotFixture(sclValue=4) {
  const grid={crs:'EPSG:32755',affine:[10,0,500000,0,-10,6300000],width:4,height:4};
  const bands:Record<string,Uint8Array>={};const manifest:ExactManifest={schema_version:1,item_id:'synthetic-item',collection:'sentinel-2-l2a',acquired_at:'2026-10-19T00:00:00Z',baseline:'05.00',cloud_mask_method:'SCL',bands:{},native_grid:grid,scl_grid:{...grid,affine:[20,0,500000,0,-20,6300000],width:2,height:2}};
  for(const key of ['red','nir','green','blue','scl']) {
    const scl=key==='scl',values=new Uint16Array(scl?4:16).fill(scl?sclValue:key==='nir'?6000:2000);
    const size=scl?2:4,res=scl?20:10;
    bands[key]=new Uint8Array(writeArrayBuffer(values,{width:size,height:size,SampleFormat:[1],BitsPerSample:[16],ModelPixelScale:[res,res,0],ModelTiepoint:[0,0,0,500000,6300000,0],ProjectedCSTypeGeoKey:32755,GTModelTypeGeoKey:1,GTRasterTypeGeoKey:1,GDAL_NODATA:'0'}));
    manifest.bands[key]={item_id:manifest.item_id,href:`https://sentinel-cogs.s3.us-west-2.amazonaws.com/synthetic/${key}.tif`,scale:scl?1:.0001,offset:0,resolution:res};
  }
  const transport:typeof fetch=async(url,init)=>{
    const key=String(url).split('/').at(-1)?.replace('.tif','');const data=key?bands[key]:null;
    const match=/^bytes=(\d+)-(\d+)$/.exec(new Headers((init as RequestInit | undefined)?.headers).get('Range')??'');
    if(!data||!match) throw new Error('Fixture range required');
    const start=Number(match[1]),end=Math.min(Number(match[2]),data.length-1);
    return new Response(data.slice(start,end+1),{status:206,headers:{'Content-Range':`bytes ${start}-${end}/${data.length}`}});
  };
  const p=projection(grid.crs);const ring=[[500000,6300000],[500040,6300000],[500040,6299960],[500000,6299960],[500000,6300000]].map(v=>p.inverse(v));
  return {manifest,ring,transport};
}
export async function runRasterFixture() {
  const f=pilotFixture(),budget=new RequestBudget(AbortSignal.timeout(10000),24,1048576,f.transport);
  const result=await renderPilot(f.manifest,f.ring,'NDVI',budget);
  if(result.summary?.mean_value!==.5 || result.assets.length!==2) throw new Error('Synthetic raster golden mismatch');
  return {synthetic:true,provider_calls:0,native_resolution_m:10,mean:.5,valid_pixels:result.summary.valid_pixel_count,verified_assets:result.assets.length,range_reads:budget.requests};
}