import { PGlite } from 'npm:@electric-sql/pglite@0.5.10';
import assert from 'node:assert/strict';
import { runPilot, PILOT_PROVIDER } from './satellite-pilot-pipeline.ts';
import { renderPilot } from './satellite-pilot-raster.ts';
import { pilotFixture, runRasterFixture } from './satellite-pilot-fixture.ts';
import { RequestBudget, Provider429 } from './satellite-bounded-cog.ts';
import { PILOT_VINEYARD, PILOT_VERSION, retryAfterMs } from './satellite-ingestion-core.ts';
import { productionItem } from './satellite-pilot-discovery.ts';
const root=new URL('../../../',import.meta.url);
const file=(p:string)=>Deno.readTextFile(new URL(p,root));
async function setup() {
  const db=new PGlite();
  await db.exec(`CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role;
    CREATE FUNCTION set_updated_at() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN NEW.updated_at=now();RETURN NEW;END $$;`);
  const base=await file('supabase/migrations/20260710034517_d69e6c4f-cbde-487a-8e34-0a12fa9e0ee2.sql');
  // Exact legacy scene/asset/summary DDL; no managed storage schema in local fixture.
  await db.exec(base.slice(0,base.indexOf('-- ---- satellite_processing_jobs')));
  await db.exec(await file('supabase/migrations/20260710225135_b380203f-9422-4a2c-9d6c-30043dbab7e7.sql'));
  const old=await file('supabase/migrations/20260713020438_89d7f076-416f-4140-ad1d-f5332cc08a3c.sql');
  await db.exec(old.slice(0,old.indexOf('-- ============ satellite_refresh_jobs')));
  await db.exec(old.slice(old.indexOf('CREATE OR REPLACE FUNCTION public.refresh_paddock_manifest'),old.indexOf('CREATE OR REPLACE FUNCTION public.satellite_scenes_manifest_sync')));
  for(const p of ['0000_satellite_ingestion_disabled_foundation.sql','0001_satellite_verification_fail_closed.sql','0002_satellite_service_privilege_hardening.sql','0003_satellite_pilot_day_selection.sql','0004_satellite_pilot_fenced_publish.sql','0005_satellite_v7_manifest_compatibility.sql','0006_satellite_reservation_null_rejection.sql','0007_satellite_raster_identity_and_blank_guard.sql','0008_satellite_terminal_quality_statuses.sql']) await db.exec(await file('drizzle/migrations/'+p));
  await db.exec(`CREATE UNIQUE INDEX satellite_scenes_unique_capture_idx ON satellite_scenes(vineyard_id,paddock_id,provider,((acquired_at AT TIME ZONE 'UTC')::date));`);
  return db;
}
// Typed API test double backed by real PostgreSQL queue/RPC transactions, not a fake queue.
function client(db:PGlite,storage:Map<string,Uint8Array>,corrupt=false) {
  class Query {
    filters:{key:string;value:unknown}[]=[];operation='select';value:any;columns='*';singleResult=false;
    constructor(public table:string){}
    select(c='*'){this.columns=c;return this;}
    eq(key:string,value:unknown){this.filters.push({key,value});return this;}
    insert(v:any){this.operation='insert';this.value=v;return this;}
    upsert(v:any){this.operation='upsert';this.value=v;return this;}
    single(){this.singleResult=true;return this;}
    maybeSingle(){this.singleResult=true;return this;}
    then(resolve:any,reject:any){return this.execute().then(resolve,reject);}
    async execute(){try{
      const values:unknown[]=[];let sql='';
      if(this.operation==='select') {sql=`SELECT ${this.columns} FROM ${this.table}`;if(this.filters.length)sql+=' WHERE '+this.filters.map(f=>{values.push(f.value);return `${f.key}=$${values.length}`;}).join(' AND ');}
      else {const keys=Object.keys(this.value);keys.forEach(k=>values.push(typeof this.value[k]==='object'?JSON.stringify(this.value[k]):this.value[k]));sql=`INSERT INTO ${this.table}(${keys.join(',')}) VALUES(${keys.map((_,i)=>'$'+(i+1)).join(',')})`;if(this.operation==='upsert')sql+=' ON CONFLICT(vineyard_id,paddock_id,provider,processing_version) DO UPDATE SET last_provider_check_at=EXCLUDED.last_provider_check_at,newest_discovered_at=EXCLUDED.newest_discovered_at';sql+=' RETURNING '+this.columns;}
      const r=await db.query(sql,values);return {data:this.singleResult?r.rows[0]:r.rows,error:null};
    }catch(error){return {data:null,error};}}
  }
  return {
    from:(table:string)=>new Query(table),
    rpc:async(name:string,args:Record<string,unknown>)=>{try{
      const keys=Object.keys(args),values=keys.map(k=>typeof args[k]==='object'?JSON.stringify(args[k]):args[k]);
      const set=name==='satellite_claim_work';const r=await db.query(`SELECT ${set?'* FROM ':''}${name}(${keys.map((k,i)=>`${k}=>$${i+1}`).join(',')})${set?'':' result'}`,values);
      return {data:set?r.rows:r.rows[0]?.result,error:null};
    }catch(error){return {data:null,error};}},
    storage:{from:()=>({upload:async(path:string,bytes:Uint8Array)=>{if(storage.has(path))return {error:{statusCode:'409'}};storage.set(path,bytes.slice());return {error:null};},download:async(path:string)=>({data:new Blob([corrupt?new Uint8Array([1]):storage.get(path)??new Uint8Array()]),error:null})})},
  };
}
async function enable(db:PGlite){await db.exec(`INSERT INTO satellite_ingestion_control(scope,scope_key,enabled) VALUES('global','all',true),('vineyard','${PILOT_VINEYARD}',true),('provider','${PILOT_PROVIDER}',true),('pixels','all',true),('publisher','all',true);INSERT INTO satellite_provider_throttle(provider,min_interval_ms) VALUES('${PILOT_PROVIDER}',1);INSERT INTO satellite_provider_budget(provider,period_kind,period_start,request_limit,processing_limit,cpu_ms_limit,transfer_limit,storage_limit,hard_spend_limit,approved_at) VALUES('${PILOT_PROVIDER}','day',current_date,10000,100,10000000,1000000000,100000000,10,now()),('${PILOT_PROVIDER}','month',date_trunc('month',now())::date,10000,100,10000000,1000000000,100000000,10,now());`);}
const fixtureTime=new Date(Date.now()-60000).toISOString();
function stac(){const f=pilotFixture();return {type:'Feature',id:'S2B_55H_20261019',collection:'sentinel-2-l2a',properties:{datetime:fixtureTime,'s2:processing_baseline':'05.00','s2:product_uri':'S2B_MSIL2A_SYNTHETIC','eo:cloud_cover':0,'proj:epsg':32755},geometry:{type:'Polygon',coordinates:[[[146,-40],[149,-40],[149,-30],[146,-30],[146,-40]]]},assets:Object.fromEntries(Object.entries(f.manifest.bands).map(([k,b])=>[k,{href:b.href,'raster:bands':[k==='scl'?{spatial_resolution:b.resolution,data_type:'uint8',nodata:0}:{scale:b.scale,offset:b.offset,spatial_resolution:b.resolution,data_type:'uint16',nodata:0}],'proj:epsg':32755,'proj:shape':k==='scl'?[2,2]:[4,4],'proj:transform':k==='scl'?f.manifest.scl_grid?.affine:f.manifest.native_grid?.affine}]))};}
function dependencies(db:PGlite,storage=new Map<string,Uint8Array>(),options:{corrupt?:boolean;stale?:boolean;status?:number;scl?:number}={}) {
  const f=pilotFixture(options.scl);const ids=Array.from({length:8},(_,i)=>`00000000-0000-4000-8000-${String(i+1).padStart(12,'0')}`);
  const paddocks=ids.map(id=>({id,vineyard_id:PILOT_VINEYARD,polygon_points:f.ring.map(v=>({longitude:v[0],latitude:v[1]}))}));
  return {unitSpend:.01,db:client(db,storage,options.corrupt),canonical:async(id?:string)=>id?(options.stale?[{...paddocks[0],polygon_points:[]}]:paddocks.filter(p=>p.id===id)):paddocks,fetch:async()=>new Response(options.status===429?'':JSON.stringify({features:[stac()],links:[]}),{status:options.status??200,headers:{'Retry-After':'2'}}),render:(m: any,r:any,l:any,b:RequestBudget)=>renderPilot(m,r,l,new RequestBudget(b.signal,24,1048576,f.transport))};
}
Deno.test('native Deno parser PNG and float GeoTIFF synthetic 10m fixture',async()=>{assert.equal((await runRasterFixture()).mean,.5);});
Deno.test('discovery -> actual atomic queue -> native NDVI -> immutable storage -> fenced v7 manifest; v6 preserved',async()=>{
  const db=await setup();try{
    await enable(db);const deps=dependencies(db);
    await db.exec(`INSERT INTO satellite_scenes(id,vineyard_id,paddock_id,provider,collection,provider_scene_id,acquired_at,quality_status,processing_status) VALUES('11111111-1111-4111-8111-111111111111','${PILOT_VINEYARD}','00000000-0000-4000-8000-000000000001','legacy','s2','old','2026-08-01','partial','complete');INSERT INTO satellite_raster_assets(satellite_scene_id,index_type,asset_type,processing_version,storage_path,mime_type) VALUES('11111111-1111-4111-8111-111111111111','NDVI','DISPLAY_RASTER','sentinel2-v6-native-10m','old.png','image/png');`);
    const discovered=await runPilot('discovery',deps as any,AbortSignal.timeout(20000));assert.equal(discovered.reason,'discovered');assert.equal((discovered as any).queued,16);
    assert.equal((await runPilot('discovery',deps as any,AbortSignal.timeout(20000)) as any).queued,0);
    // Pin mock catalogue datetime across retries by querying existing acquisition; no second item versions in fixture.
    const published=await runPilot('worker',deps as any,AbortSignal.timeout(20000));assert.equal(published.reason,'published');
    const stats=await db.query<any>('select mean_value,valid_pixel_count from satellite_index_summaries');assert.equal(Number(stats.rows[0].mean_value),.5);assert.equal(stats.rows[0].valid_pixel_count,16);
    const manifest=await db.query<any>('select * from satellite_paddock_manifest where latest_processing_version=$1',[PILOT_VERSION]);assert.equal(manifest.rows.length,1);assert.equal(manifest.rows[0].package_status,'display_available');assert.equal(manifest.rows[0].missing_summary_count,0);
    assert.equal((await db.query('select * from satellite_raster_assets where processing_version=$1',['sentinel2-v6-native-10m'])).rows.length,1);
    assert.equal((await db.query('select * from satellite_raster_assets where native_resolution_m=10 and verified_at is not null')).rows.length,2);
    const two=await Promise.all([runPilot('worker',deps as any,AbortSignal.timeout(20000)),runPilot('worker',deps as any,AbortSignal.timeout(20000))]);
    assert.equal(two.filter(r=>r.reason==='published').length,1);assert.equal(two.filter(r=>r.reason==='budget_or_backoff').length,1);
    for(let i=0;i<15;i++) await runPilot('worker',deps as any,AbortSignal.timeout(20000));
    const complete=await db.query<any>('select * from satellite_paddock_manifest where latest_processing_version=$1',[PILOT_VERSION]);
    assert.equal(complete.rows.length,8);assert.ok(complete.rows.every(r=>r.package_status==='complete'&&r.missing_summary_count===0));
  }finally{await db.close();}
});
Deno.test('quota ZERO and switches OFF cause zero HTTP and no queue; service grants reject browsers',async()=>{
  const db=await setup();try{const deps=dependencies(db);deps.fetch=async()=>{throw new Error('Provider must not be called');};assert.equal((await runPilot('discovery',deps as any,AbortSignal.timeout(10000))).reason,'disabled');await enable(db);await db.exec('update satellite_provider_budget set hard_spend_limit=0');assert.equal((await runPilot('discovery',deps as any,AbortSignal.timeout(10000))).reason,'budget_or_backoff');for(const role of ['anon','authenticated']){for(const table of ['satellite_acquisitions','satellite_work_items','satellite_pilot_day_selection'])assert.equal((await db.query<any>('select has_table_privilege($1,$2,$3) allowed',[role,table,'SELECT,INSERT,UPDATE,DELETE'])).rows[0].allowed,false);assert.equal((await db.query<any>('select has_function_privilege($1,$2,$3) allowed',[role,'satellite_claim_work(uuid,text)','EXECUTE'])).rows[0].allowed,false);}}finally{await db.close();}
});
Deno.test('partial storage never publishes, stale boundary terminates before pixels, 429 persists global backoff',async()=>{
  const db=await setup();try{await enable(db);const deps=dependencies(db);await runPilot('discovery',deps as any,AbortSignal.timeout(20000));const bad=await runPilot('worker',dependencies(db,new Map(),{corrupt:true}) as any,AbortSignal.timeout(20000));assert.equal(bad.reason,'Storage content checksum mismatch');assert.equal((await db.query('select * from satellite_raster_assets')).rows.length,0);const stale=await runPilot('worker',dependencies(db,new Map(),{stale:true}) as any,AbortSignal.timeout(20000));assert.equal(stale.provider_calls,0);assert.equal((stale as any).failed,true);const limited=await runPilot('discovery',dependencies(db,new Map(),{status:429}) as any,AbortSignal.timeout(20000));assert.equal(limited.reason,'Provider backoff required');assert.equal(Number((await db.query<any>('select rate_limited_count from satellite_provider_throttle')).rows[0].rate_limited_count),1);}finally{await db.close();}
});
Deno.test('wrong product, multi-tile, absent scale, bad raster and cancellation fail closed',async()=>{
  for(const mutate of [(i:any)=>i.properties['s2:product_uri']='wrong',(i:any)=>i.geometry.type='MultiPolygon',(i:any)=>delete i.assets.nir['raster:bands'][0].scale,(i:any)=>i.assets.blue.href='https://evil.invalid/b.tif']){const i=stac();mutate(i);assert.throws(()=>productionItem(i));}
  const f=pilotFixture();await assert.rejects(()=>renderPilot(f.manifest,f.ring,'NDVI',new RequestBudget(AbortSignal.abort(),24,1048576,f.transport)));
  await assert.rejects(()=>renderPilot(f.manifest,f.ring,'NDVI',new RequestBudget(AbortSignal.timeout(1000),24,1048576,async()=>new Response('invalid',{status:200}))));
  assert.equal(retryAfterMs('1500'),1500);assert.equal(retryAfterMs('invalid'),null);
});
Deno.test('crash mid-upload reclaims lease with new token and immutable object retry succeeds',async()=>{
  const db=await setup();try{
    await enable(db);const storage=new Map<string,Uint8Array>(),deps=dependencies(db,storage);await runPilot('discovery',deps as any,AbortSignal.timeout(20000));
    const crash=dependencies(db,storage,{corrupt:true});await runPilot('worker',crash as any,AbortSignal.timeout(20000));
    assert.equal(storage.size,1);assert.equal((await db.query('select * from satellite_raster_assets')).rows.length,0);
    await db.exec("update satellite_work_items set due_at=now(),status='leased',lease_token='11111111-1111-4111-8111-111111111111',lease_expires_at=now()-interval '1 second' where status='retry'");
    assert.equal((await runPilot('worker',deps as any,AbortSignal.timeout(20000))).reason,'published');
    assert.equal((await db.query('select * from satellite_raster_assets')).rows.length,2);
  }finally{await db.close();}
});
Deno.test('same-day alternative acquisition cannot replace authorised product; late publication token rejected',async()=>{
  const db=await setup();try{
    await enable(db);await runPilot('discovery',dependencies(db) as any,AbortSignal.timeout(20000));
    const first=(await db.query<any>('select * from satellite_acquisitions limit 1')).rows[0];
    const other=(await db.query<any>("insert into satellite_acquisitions(provider,collection,provider_scene_id,acquired_at,source_manifest,source_manifest_hash) values($1,$2,'different-product',$3,$4,$5) returning id",[PILOT_PROVIDER,first.collection,first.acquired_at,'{}','a'.repeat(64)])).rows[0];
    assert.equal((await db.query<any>('select satellite_enqueue_pilot($1,$2,$3,$4) n',[other.id,'00000000-0000-4000-8000-000000000001','[]','b'.repeat(64)])).rows[0].n,0);
    const w=(await db.query<any>('select * from satellite_claim_work($1,$2)',[PILOT_VINEYARD,PILOT_PROVIDER])).rows[0];
    await assert.rejects(()=>db.query('select satellite_publish_pilot($1,$2,$3)',[w.id,'22222222-2222-4222-8222-222222222222','{}']));
    assert.equal((await db.query('select * from satellite_scenes')).rows.length,0);
  }finally{await db.close();}
});
Deno.test('all-cloud SCL is terminal cloud_obscured after SCL preflight, before any spectral band read or storage write',async()=>{
  const f=pilotFixture(9);
  for(const layer of ['NDVI','TRUE_COLOUR'] as const) await assert.rejects(()=>renderPilot(f.manifest,f.ring,layer,new RequestBudget(AbortSignal.timeout(10000),24,1048576,f.transport)),/Cloud-obscured paddock/);
  assert.equal(f.reads.red??0,0);assert.equal(f.reads.nir??0,0);assert.equal(f.reads.blue??0,0);assert.ok((f.reads.scl??0)>0);
  const db=await setup();try{
    await enable(db);const storage=new Map<string,Uint8Array>();const deps=dependencies(db,storage,{scl:9});
    assert.equal((await runPilot('discovery',deps as any,AbortSignal.timeout(20000))).reason,'discovered');
    const run=await runPilot('worker',deps as any,AbortSignal.timeout(20000)) as any;
    assert.equal(run.failed,true);assert.equal(run.terminal,true);assert.equal(run.reason,'cloud_obscured');
    assert.equal(run.scl_histogram['9'],16);
    assert.equal(storage.size,0);
    assert.equal((await db.query('select * from satellite_raster_assets')).rows.length,0);
    const w=await db.query<any>("select status,attempts,output_manifest->>'quality' q,output_manifest->'scl_histogram'->>'9' h from satellite_work_items where status<>'queued'");
    assert.equal(w.rows[0].status,'cloud_obscured');assert.equal(w.rows[0].attempts,1);assert.equal(w.rows[0].q,'cloud_obscured');assert.equal(w.rows[0].h,'16');
    // Terminal quality work is never re-claimed: the next worker run picks a different queued item.
    const again=await runPilot('worker',deps as any,AbortSignal.timeout(20000)) as any;
    assert.equal(again.reason,'cloud_obscured');
    assert.equal((await db.query<any>("select count(*) c from satellite_work_items where status='cloud_obscured'")).rows[0].c,'2');
  } finally { await db.close(); }
});
Deno.test('cirrus (SCL 10) and all-nodata are terminal without retry; mixed cloud publishes honest partial coverage',async()=>{
  for(const scl of [10,[9,9,9,9]]) await assert.rejects(()=>{const f=pilotFixture(scl as any);return renderPilot(f.manifest,f.ring,'NDVI',new RequestBudget(AbortSignal.timeout(10000),24,1048576,f.transport));},/Cloud-obscured paddock/);
  // All spectral cells nodata (0) with valid SCL: preflight passes, calibration yields zero usable pixels.
  const nf=pilotFixture(4,0);
  await assert.rejects(()=>renderPilot(nf.manifest,nf.ring,'NDVI',new RequestBudget(AbortSignal.timeout(10000),24,1048576,nf.transport)),/No usable pixels after calibration/);
  // Half cloud, half vegetation: publishes with real partial coverage, no fabricated mean.
  const mf=pilotFixture([9,9,4,4]);
  const partial=await renderPilot(mf.manifest,mf.ring,'NDVI',new RequestBudget(AbortSignal.timeout(10000),24,1048576,mf.transport));
  assert.equal(partial.summary?.valid_pixel_count,8);assert.equal(partial.valid_coverage_percent,50);assert.equal(partial.summary?.mean_value,.5);
});
Deno.test('discovery skips acquisitions already proven cloud-obscured for a paddock and queues the next newest item',async()=>{
  const db=await setup();try{
    await enable(db);const deps=dependencies(db);
    assert.equal((await runPilot('discovery',deps as any,AbortSignal.timeout(20000)) as any).queued,16);
    // Mark the discovered scene terminally clouded for one paddock, then offer a newer and an older item.
    const acq=(await db.query<any>('select id from satellite_acquisitions')).rows[0];
    await db.exec(`update satellite_work_items set status='cloud_obscured' where paddock_id='00000000-0000-4000-8000-000000000001' and acquisition_id='${acq.id}'`);
    const today=new Date();today.setUTCHours(0,0,0,0);
    const mid=stac();mid.id='S2B_55H_MINUS1';mid.properties.datetime=new Date(today.getTime()-86400000+900000).toISOString();
    const older=stac();older.id='S2B_55H_MINUS2';older.properties.datetime=new Date(today.getTime()-2*86400000+900000).toISOString();
    deps.fetch=async()=>new Response(JSON.stringify({features:[older,mid],links:[]}),{status:200});
    const second=await runPilot('discovery',deps as any,AbortSignal.timeout(20000)) as any;
    assert.equal(second.reason,'discovered');
    // Paddock 1 must be queued against the next newest item (not the clouded one, not the older one).
    const rows=(await db.query<any>(`select w.paddock_id,a.provider_scene_id from satellite_work_items w join satellite_acquisitions a on a.id=w.acquisition_id where w.paddock_id='00000000-0000-4000-8000-000000000001'`)).rows;
    assert.ok(rows.some(r=>r.provider_scene_id==='S2B_55H_MINUS1'));
    assert.ok(!rows.some(r=>r.provider_scene_id==='S2B_55H_MINUS2'));
  } finally { await db.close(); }
});
Deno.test('database refuses blank v7 proofs and cross-version reuse of one storage key',async()=>{
  const db=await setup();try{
    await db.exec(`INSERT INTO satellite_scenes(id,vineyard_id,paddock_id,provider,collection,provider_scene_id,acquired_at,quality_status,processing_status) VALUES('22222222-2222-4222-8222-222222222222','${PILOT_VINEYARD}','00000000-0000-4000-8000-000000000002','legacy','s2','old','2026-08-01','partial','complete');
      INSERT INTO satellite_raster_assets(satellite_scene_id,index_type,asset_type,processing_version,storage_path,mime_type) VALUES('22222222-2222-4222-8222-222222222222','NDVI','DISPLAY_RASTER','sentinel2-v3-eleven-layers','v/p/2026-08-01/S2A/NDVI.png','image/png');`);
    await assert.rejects(()=>db.exec(`INSERT INTO satellite_raster_assets(satellite_scene_id,index_type,asset_type,processing_version,storage_path,mime_type) VALUES('22222222-2222-4222-8222-222222222222','NDVI','DISPLAY_RASTER','sentinel2-v6-native-10m','v/p/2026-08-01/S2A/NDVI.png','image/png')`),/another processing version/);
    const path=`v/p/a/${PILOT_VERSION}/NDVI/x.png`;
    for(const proof of ['{"valid_pixel_count":0,"display_visible_pixel_count":0}','{"valid_pixel_count":16,"display_visible_pixel_count":0}','{}'])
      await assert.rejects(()=>db.exec(`INSERT INTO satellite_raster_assets(satellite_scene_id,index_type,asset_type,processing_version,storage_path,mime_type,provenance) VALUES('22222222-2222-4222-8222-222222222222','TRUE_COLOUR','DISPLAY_RASTER','${PILOT_VERSION}','${path}','image/png','${proof}')`),/Blank/);
    await assert.rejects(()=>db.exec(`INSERT INTO satellite_raster_assets(satellite_scene_id,index_type,asset_type,processing_version,storage_path,mime_type,provenance) VALUES('22222222-2222-4222-8222-222222222222','NDVI','ANALYTICAL_RASTER','${PILOT_VERSION}','v/p/a/${PILOT_VERSION}/NDVI/x.tif','image/tiff','{"valid_pixel_count":16,"analytical_valid_cell_count":15}')`),/analytical/);
    await assert.rejects(()=>db.exec(`INSERT INTO satellite_raster_assets(satellite_scene_id,index_type,asset_type,processing_version,storage_path,mime_type,provenance) VALUES('22222222-2222-4222-8222-222222222222','NDVI','DISPLAY_RASTER','${PILOT_VERSION}','v/p/a/NDVI/x.png','image/png','{"valid_pixel_count":16,"display_visible_pixel_count":16}')`),/version-scoped/);
  } finally { await db.close(); }
});
