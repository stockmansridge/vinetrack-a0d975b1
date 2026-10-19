// @deno-types="./vendor/geotiff.d.ts"
import { writeArrayBuffer, fromArrayBuffer } from './vendor/geotiff.js';
import { encode, decode } from 'npm:fast-png@6.4.0';
import { processNativePixels, validateNativeGrid, validScl, TerminalQualityError, MIN_VALID_COVERAGE_PERCENT, type ExactManifest, type NativeGrid, type PilotLayer } from './satellite-ingestion-core.ts';
import { requireAlignedScl, sampleSclNearest } from './satellite-exact-adapter.ts';
import { nativeWindow, pixelMask, projection, sha256, hashJson } from './satellite-pilot-geometry.ts';
import { readExactNativeWindow, RequestBudget } from './satellite-bounded-cog.ts';
import { countVisibleRgba, countValidCells } from './satellite-raster-usability.ts';
export async function renderPilot(manifest: ExactManifest, ring: number[][], layer: PilotLayer, budget: RequestBudget) {
  // Source grid is recorded by discovery and must match the TIFF itself.
  const source=manifest.native_grid;
  if (!source) throw new Error('Missing signed native source grid');
  const {window,projected}=nativeWindow(ring,source);
  // Measurement grid derived from the immutable STAC grid + window; verified against each TIFF below.
  const grid:NativeGrid={crs:source.crs,affine:[source.affine[0],0,source.affine[2]+window[0]*source.affine[0],0,source.affine[4],source.affine[5]+window[1]*source.affine[4]],width:window[2]-window[0],height:window[3]-window[1]};
  validateNativeGrid(grid);
  const inside=pixelMask(grid,projected);
  // SCL-first preflight: classify the exact paddock geometry before any spectral band read.
  const sclSource=manifest.scl_grid;
  if (!sclSource) throw new Error('Missing SCL source grid');
  requireAlignedScl(source,sclSource);
  const sclWindow=nativeWindow(ring,sclSource).window;
  const scl=await readExactNativeWindow(manifest.bands.scl.href,sclWindow,budget);
  if (await hashJson(scl.source_grid)!==await hashJson(sclSource)) throw new Error('SCL native grid mismatch');
  const mask=Array.from({length:grid.width*grid.height},(_,i)=>sampleSclNearest(grid.affine[2]+(i%grid.width+.5)*10,grid.affine[5]-(Math.floor(i/grid.width)+.5)*10,{affine:scl.measurement_grid.affine,width:scl.measurement_grid.width,height:scl.measurement_grid.height,values:Array.from(scl.data as ArrayLike<number>)}));
  const histogram:Record<string,number>={};let validSclCount=0,paddockPixels=0;
  for(let i=0;i<mask.length;i++){if(!inside[i])continue;paddockPixels++;histogram[String(mask[i])]=(histogram[String(mask[i])]??0)+1;if(validScl(mask[i]))validSclCount++;}
  if(paddockPixels===0)throw new TerminalQualityError('insufficient_coverage',histogram,'Paddock boundary covers no native cells');
  // Terminal cloud/shadow/snow occlusion: skip spectral bands entirely, never retried for this acquisition.
  if(validSclCount===0)throw new TerminalQualityError('cloud_obscured',histogram,`Cloud-obscured paddock: 0/${paddockPixels} usable SCL cells (${JSON.stringify(histogram)})`);
  const keys=layer==='NDVI'?['red','nir']:['red','green','blue'];
  const bands: Record<string, Awaited<ReturnType<typeof readExactNativeWindow>>>={};
  for (const key of keys) {
    const b=await readExactNativeWindow(manifest.bands[key].href,window,budget);
    if (await hashJson(b.source_grid)!==await hashJson(source)) throw new Error('COG native grid differs from immutable STAC');
    bands[key]=b;
  }
  if(bands.red.measurement_grid.width!==grid.width||bands.red.measurement_grid.height!==grid.height) throw new Error('COG native grid differs from immutable STAC');
  const noData=bands.red.no_data;
  if (noData==null || keys.some(k=>bands[k].no_data!==noData)) throw new Error('Missing/mismatched nodata');
  let rendered;
  try {
    rendered=await packagePixels({ grid,layer,red:Array.from(bands.red.data as ArrayLike<number>),nir:bands.nir?Array.from(bands.nir.data as ArrayLike<number>):undefined,green:bands.green?Array.from(bands.green.data as ArrayLike<number>):undefined,blue:bands.blue?Array.from(bands.blue.data as ArrayLike<number>):undefined,scl:mask,inside,scales:manifest.bands,noData });
  } catch(error) {
    if(error instanceof Error&&error.message==='No valid paddock pixels')throw new TerminalQualityError('insufficient_coverage',histogram,'No usable pixels after calibration/nodata filtering');
    throw error;
  }
  // Honest partial coverage: below the minimum usable share this is a terminal quality result, not a publishable raster.
  if(rendered.valid_coverage_percent!=null&&rendered.valid_coverage_percent<MIN_VALID_COVERAGE_PERCENT)throw new TerminalQualityError('insufficient_coverage',histogram,`Only ${rendered.valid_coverage_percent.toFixed(1)}% usable paddock coverage (minimum ${MIN_VALID_COVERAGE_PERCENT}%)`);
  return {...rendered,scl_histogram:histogram};
}
export async function packagePixels(input: Parameters<typeof processNativePixels>[0]) {
  const result=processNativePixels(input);
  if (!result.valid_pixel_count || !result.paddock_pixel_count) throw new Error('No valid paddock pixels');
  const grid=input.grid,p=projection(grid.crs),a=grid.affine;
  const corners=[[a[2],a[5]],[a[2]+grid.width*10,a[5]],[a[2],a[5]-grid.height*10],[a[2]+grid.width*10,a[5]-grid.height*10]].map(v=>p.inverse(v));
  const bounds={west:Math.min(...corners.map(v=>v[0])),east:Math.max(...corners.map(v=>v[0])),south:Math.min(...corners.map(v=>v[1])),north:Math.max(...corners.map(v=>v[1]))};
  // Geographic display pixels are inverse mapped to native cells; never used for statistics.
  const display=new Uint8Array(result.rgba.length);
  for(let y=0;y<grid.height;y++) for(let x=0;x<grid.width;x++) {
    const v=p.forward([bounds.west+(x+.5)*(bounds.east-bounds.west)/grid.width,bounds.north-(y+.5)*(bounds.north-bounds.south)/grid.height]);
    const col=Math.floor((v[0]-a[2])/10),row=Math.floor((a[5]-v[1])/10);
    if(col>=0&&row>=0&&col<grid.width&&row<grid.height) display.set(result.rgba.subarray((row*grid.width+col)*4,(row*grid.width+col)*4+4),(y*grid.width+x)*4);
  }
  const png=encode({width:grid.width,height:grid.height,data:display,channels:4,depth:8});
  const decoded=decode(png); if(decoded.width!==grid.width||decoded.height!==grid.height) throw new Error('PNG verification failed');
  // Fail closed before any storage write: a decodable PNG with no visible pixels is not imagery.
  const display_visible_pixel_count=countVisibleRgba(decoded.data as ArrayLike<number>,decoded.channels);
  if(display_visible_pixel_count===0) throw new Error('Blank display raster: zero visible pixels after encoding');
  const assets=[{kind:'DISPLAY_RASTER',mime:'image/png',bytes:png,sha256:await sha256(png),width:grid.width,height:grid.height,bounds,native_resolution_m:10,display_resolution_m:null}];
  let analytical_valid_cell_count: number|null=null;
  if(input.layer==='NDVI') {
    const bytes=new Uint8Array(writeArrayBuffer(result.analytical,{width:grid.width,height:grid.height,SampleFormat:[3],BitsPerSample:[32],ModelPixelScale:[10,10,0],ModelTiepoint:[0,0,0,a[2],a[5],0],ProjectedCSTypeGeoKey:Number(grid.crs.slice(5)),GTModelTypeGeoKey:1,GTRasterTypeGeoKey:1,GDAL_NODATA:'-9999'}));
    const check=await fromArrayBuffer(bytes.buffer);const image=await check.getImage();
    const values=await image.readRasters({interleave:true});
    if(image.getWidth()!==grid.width||image.getHeight()!==grid.height||image.getGeoKeys()?.ProjectedCSTypeGeoKey!==Number(grid.crs.slice(5))||Array.from(values as ArrayLike<number>).some((v,i)=>v!==result.analytical[i])) throw new Error('GeoTIFF readback mismatch');
    analytical_valid_cell_count=countValidCells(values as ArrayLike<number>,-9999,[-1,1]);
    if(analytical_valid_cell_count===0) throw new Error('Blank analytical raster: every cell is no-data');
    if(analytical_valid_cell_count!==result.valid_pixel_count) throw new Error('Analytical readback valid cells differ from statistics');
    assets.push({kind:'ANALYTICAL_RASTER',mime:'image/tiff',bytes,sha256:await sha256(bytes),width:grid.width,height:grid.height,bounds,native_resolution_m:10,display_resolution_m:null});
  }
  return {assets,summary:result.summary,grid,bounds,display_visible_pixel_count,analytical_valid_cell_count,cloud_percent:result.cloud_percent,valid_coverage_percent:result.valid_coverage_percent,no_data_pixel_count:grid.width*grid.height-result.valid_pixel_count,valid_pixel_count:result.valid_pixel_count};
}