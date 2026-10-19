import { PILOT_VINEYARD, PILOT_VERSION, insidePolygon, type ExactManifest } from './satellite-ingestion-core.ts';
import { productionItem, EARTH_SEARCH_URL } from './satellite-pilot-discovery.ts';
import { canonicalRing, hashJson, sha256 } from './satellite-pilot-geometry.ts';
import { Provider429, RequestBudget } from './satellite-bounded-cog.ts';
import { renderPilot } from './satellite-pilot-raster.ts';
export const PILOT_PROVIDER='EARTH_SEARCH_SENTINEL_2';
export interface PipelineDependencies {
  db: any;
  canonical: (id?:string)=>Promise<any[]>;
  fetch: typeof fetch;
  render: typeof renderPilot;
  unitSpend?: number;
}
async function rpc(db:any,name:string,args:any) { const r=await db.rpc(name,args);if(r.error) throw r.error;return r.data; }
export async function runPilot(kind:'worker'|'discovery',deps:PipelineDependencies,signal:AbortSignal) {
  const {db}=deps;
  if(!await rpc(db,'satellite_pipeline_enabled',{p_vineyard:PILOT_VINEYARD,p_provider:PILOT_PROVIDER,p_pixels:kind==='worker'})) return {reason:'disabled',provider_calls:0,no_op:true};
  // Publisher kill-switch required before spending on any pixels.
  if(kind==='worker') {
    const c=await db.from('satellite_ingestion_control').select('enabled').eq('scope','publisher').eq('scope_key','all').maybeSingle();
    if(c.error||!c.data?.enabled) return {reason:'publisher_disabled',provider_calls:0,no_op:true};
  }
  if(!Number.isFinite(deps.unitSpend)||!deps.unitSpend||deps.unitSpend<=0) return {reason:'unit_cost_not_approved',provider_calls:0,no_op:true};
  const reservation=await rpc(db,'satellite_reserve_provider',{p_provider:PILOT_PROVIDER,p_vineyard:PILOT_VINEYARD,p_requests:kind==='discovery'?1:24,p_processing:kind==='discovery'?0:1,p_cpu:kind==='discovery'?1000:45000,p_transfer:kind==='discovery'?1048576:16777216,p_storage:kind==='discovery'?0:4194304,p_spend:deps.unitSpend,p_pixels:kind==='worker'});
  if(!reservation) return {reason:'budget_or_backoff',provider_calls:0,no_op:true};
  let calls=0,work:any;const budget=new RequestBudget(signal,24,16777216,deps.fetch);
  try {
    if(kind==='discovery') {
      const paddocks=await deps.canonical();
      if(paddocks.length!==8) throw new Error('Pilot must resolve exactly eight active paddocks');
      const rings=paddocks.map(p=>canonicalRing(p.polygon_points));
      const now=new Date(),since=new Date(now.getTime()-7*86400000);
      calls++;
      const res=await deps.fetch(EARTH_SEARCH_URL,{method:'POST',redirect:'error',signal,headers:{'Content-Type':'application/json'},body:JSON.stringify({collections:['sentinel-2-l2a'],bbox:[Math.min(...rings.flat().map(v=>v[0])),Math.min(...rings.flat().map(v=>v[1])),Math.max(...rings.flat().map(v=>v[0])),Math.max(...rings.flat().map(v=>v[1]))],datetime:`${since.toISOString()}/${now.toISOString()}`,limit:50,sortby:[{field:'properties.datetime',direction:'desc'}]})});
      if(res.status===429){await res.body?.cancel();throw new Provider429(httpRetry(res.headers.get('Retry-After')));}
      if(!res.ok) {await res.body?.cancel();throw new Error('Catalogue HTTP failure');}
      const text=await boundedText(res,1048576);const page=JSON.parse(text);
      if(!Array.isArray(page.features)||page.features.length>50||page.links?.some((l:any)=>l.rel==='next')) throw new Error('Unbounded catalogue results');
      const items=page.features.map(productionItem).filter((m:ExactManifest)=>Date.parse(m.acquired_at)>=since.getTime()&&Date.parse(m.acquired_at)<=now.getTime()).sort((a:ExactManifest,b:ExactManifest)=>b.acquired_at.localeCompare(a.acquired_at)||a.item_id.localeCompare(b.item_id));
      let queued=0;
      for(let i=0;i<paddocks.length;i++) {
        const manifest=items.find((m:ExactManifest)=>m.footprint&&rings[i].every(v=>insidePolygon(v[0],v[1],[m.footprint as number[][]])));
        if(!manifest) {
          const f=await db.from('satellite_freshness').upsert({vineyard_id:PILOT_VINEYARD,paddock_id:paddocks[i].id,provider:PILOT_PROVIDER,processing_version:PILOT_VERSION,last_provider_check_at:now.toISOString()},{onConflict:'vineyard_id,paddock_id,provider,processing_version'});if(f.error) throw f.error;
          continue;
        }
        const hash=await hashJson(manifest);
        const row={provider:PILOT_PROVIDER,collection:manifest.collection,provider_scene_id:manifest.item_id,acquired_at:manifest.acquired_at,source_manifest:manifest,source_manifest_hash:hash};
        const inserted=await db.from('satellite_acquisitions').insert(row).select('id').single();
        let id=inserted.data?.id;
        if(inserted.error?.code==='23505') {const r=await db.from('satellite_acquisitions').select('id').eq('provider',PILOT_PROVIDER).eq('collection',manifest.collection).eq('provider_scene_id',manifest.item_id).eq('source_manifest_hash',hash).single();if(r.error) throw r.error;id=r.data.id;}
        else if(inserted.error) throw inserted.error;
        if(!id) throw new Error('Missing immutable acquisition');
        queued+=await rpc(db,'satellite_enqueue_pilot',{p_acquisition:id,p_paddock:paddocks[i].id,p_boundary:rings[i],p_hash:await hashJson(rings[i])});
        const f=await db.from('satellite_freshness').upsert({vineyard_id:PILOT_VINEYARD,paddock_id:paddocks[i].id,provider:PILOT_PROVIDER,processing_version:PILOT_VERSION,last_provider_check_at:now.toISOString(),newest_discovered_at:manifest.acquired_at},{onConflict:'vineyard_id,paddock_id,provider,processing_version'});if(f.error) throw f.error;
      }
      return {reason:'discovered',queued,provider_calls:calls,no_op:false};
    }
    const claimed=await rpc(db,'satellite_claim_work',{p_vineyard:PILOT_VINEYARD,p_provider:PILOT_PROVIDER});work=claimed?.[0];
    if(!work) return {reason:'idle',provider_calls:0,no_op:true};
    const canonical=await deps.canonical(work.paddock_id);
    if(canonical.length!==1||await hashJson(canonicalRing(canonical[0].polygon_points))!==work.boundary_hash) throw new Error('Stale canonical boundary');
    const a=await db.from('satellite_acquisitions').select('*').eq('id',work.acquisition_id).single();if(a.error) throw a.error;
    if(await hashJson(a.data.source_manifest)!==a.data.source_manifest_hash) throw new Error('Immutable provenance hash mismatch');
    const rendered=await deps.render(a.data.source_manifest,work.boundary_snapshot,work.layer,budget);
    if(signal.aborted) throw new Error('Worker deadline');
    // Re-read canonical boundary after potentially slow decoding, before publication.
    const fresh=await deps.canonical(work.paddock_id);if(fresh.length!==1||await hashJson(canonicalRing(fresh[0].polygon_points))!==work.boundary_hash) throw new Error('Boundary changed during processing');
    const assets=[];
    if(rendered.assets.reduce((n,a)=>n+a.bytes.length,0)>4194304) throw new Error('Storage byte reservation exceeded');
    for(const asset of rendered.assets) {
      const path=`${PILOT_VINEYARD}/${work.paddock_id}/${work.acquisition_id}/${PILOT_VERSION}/${work.layer}/${asset.sha256}.${asset.kind==='DISPLAY_RASTER'?'png':'tif'}`;
      const storage=db.storage.from('satellite-assets');const upload=await storage.upload(path,asset.bytes,{contentType:asset.mime,upsert:false});
      if(upload.error&&!['Duplicate','409'].includes(String(upload.error.statusCode))&&!String(upload.error.message).includes('already exists')) throw new Error('Immutable storage write failed');
      const readback=await storage.download(path);if(readback.error||!readback.data) throw new Error('Storage readback failed');
      if(readback.data.size!==asset.bytes.length) throw new Error('Storage content checksum mismatch');
      const bytes=new Uint8Array(await readback.data.arrayBuffer());
      if(bytes.length!==asset.bytes.length||await sha256(bytes)!==asset.sha256) throw new Error('Storage content checksum mismatch');
      assets.push({...asset,bytes:bytes.length,path});
    }
    const proof={schema_version:1,verified:true,acquisition_id:work.acquisition_id,source_manifest_hash:a.data.source_manifest_hash,boundary_hash:work.boundary_hash,layer:work.layer,processing_version:PILOT_VERSION,assets,summary:rendered.summary,measurement_grid:rendered.grid,display_crs:'EPSG:4326',source:a.data.source_manifest,cloud_percent:rendered.cloud_percent,valid_coverage_percent:rendered.valid_coverage_percent,no_data_pixel_count:rendered.no_data_pixel_count};
    if(signal.aborted) throw new Error('Publication deadline');
    const scene=await rpc(db,'satellite_publish_pilot',{p_work:work.id,p_token:work.lease_token,p_output:proof});
    return {reason:'published',scene_id:scene,provider_calls:budget.requests,no_op:false};
  } catch(error) {
    const retry=error instanceof Provider429?error.retryMs:null;
    if(work) await rpc(db,'satellite_finish_work',{p_id:work.id,p_token:work.lease_token,p_status:'retry',p_error:error instanceof Error?error.message:'Pipeline failure',p_retry_ms:retry??30000});
    if(retry!=null) await rpc(db,'satellite_release_provider',{p_provider:PILOT_PROVIDER,p_token:reservation,p_retry_ms:retry});
    return {reason:error instanceof Error?error.message:'Pipeline failure',provider_calls:kind==='worker'?budget.requests:calls,no_op:calls+budget.requests===0,failed:true};
  } finally { await rpc(db,'satellite_release_provider',{p_provider:PILOT_PROVIDER,p_token:reservation}); }
}
function httpRetry(value:string|null){const numeric=Number(value);if(value&&Number.isFinite(numeric)&&numeric>=0)return Math.min(86400000,numeric*1000);const t=value?Date.parse(value):NaN;return Number.isFinite(t)?Math.min(86400000,Math.max(0,t-Date.now())):60000;}
async function boundedText(res:Response,max:number){if(!res.body)throw new Error('Missing catalogue body');const reader=res.body.getReader();let n=0;const chunks=[];try{while(true){const r=await reader.read();if(r.done)break;n+=r.value.length;if(n>max){await reader.cancel();throw new Error('Catalogue byte ceiling');}chunks.push(r.value);}}finally{reader.releaseLock();}const out=new Uint8Array(n);let i=0;for(const c of chunks){out.set(c,i);i+=c.length;}return new TextDecoder().decode(out);}