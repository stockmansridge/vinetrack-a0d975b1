// @vitest-environment node
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, expect, it } from 'vitest';
const db = new PGlite();
const vineyard='fe952afe-437f-4be7-8cbf-fdd8e630411c', provider='EARTH_SEARCH_SENTINEL_2';
beforeAll(async()=>{
  await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
    CREATE TABLE satellite_scenes(id uuid PRIMARY KEY); CREATE TABLE satellite_raster_assets(id uuid PRIMARY KEY);
    CREATE TABLE satellite_index_summaries(id uuid PRIMARY KEY);`);
  await db.exec(readFileSync('drizzle/migrations/0000_satellite_ingestion_disabled_foundation.sql','utf8'));
},30000);
afterAll(()=>db.close());
it('actual schema denies browser table access, all controls default OFF, and disabled claims return no work',async()=>{
  const r=await db.query<{allowed:boolean}>('select has_table_privilege($1,$2,$3) as allowed',['authenticated','satellite_work_items','SELECT']);
  expect(r.rows[0].allowed).toBe(false);
  expect((await db.query('select * from satellite_claim_work($1,$2)',[vineyard,provider])).rows).toHaveLength(0);
  expect((await db.query<{enabled:boolean}>('select satellite_pipeline_enabled($1,$2,true) enabled',[vineyard,provider])).rows[0].enabled).toBe(false);
});
it('actual queue enforces idempotency, fresh priority, lease fencing and expired-worker rejection',async()=>{
  await db.exec(`INSERT INTO satellite_ingestion_control(scope,scope_key,enabled) VALUES ('global','all',true),('vineyard','${vineyard}',true),('provider','${provider}',true),('pixels','all',true);
    INSERT INTO satellite_acquisitions(id,provider,collection,provider_scene_id,acquired_at,source_manifest,source_manifest_hash) VALUES
    ('11111111-1111-4111-8111-111111111111','${provider}','s2','old','2026-08-01','{}','${'a'.repeat(64)}'),
    ('22222222-2222-4222-8222-222222222222','${provider}','s2','new','2026-10-19','{}','${'b'.repeat(64)}');
    INSERT INTO satellite_work_items(vineyard_id,paddock_id,acquisition_id,layer,lane,boundary_snapshot,boundary_hash) VALUES
    ('${vineyard}','33333333-3333-4333-8333-333333333333','11111111-1111-4111-8111-111111111111','NDVI','backfill','{}','${'c'.repeat(64)}'),
    ('${vineyard}','33333333-3333-4333-8333-333333333333','22222222-2222-4222-8222-222222222222','NDVI','fresh','{}','${'c'.repeat(64)}');`);
  const [first,second]=await Promise.all([db.query<any>('select * from satellite_claim_work($1,$2)',[vineyard,provider]),db.query<any>('select * from satellite_claim_work($1,$2)',[vineyard,provider])]);
  expect(first.rows[0].lane).toBe('fresh'); expect(second.rows[0].lane).toBe('backfill'); expect(first.rows[0].id).not.toBe(second.rows[0].id);
  const work=first.rows[0];
  await expect(db.exec(`INSERT INTO satellite_work_items(vineyard_id,paddock_id,acquisition_id,layer,boundary_snapshot,boundary_hash) VALUES('${vineyard}','33333333-3333-4333-8333-333333333333','22222222-2222-4222-8222-222222222222','NDVI','{}','${'c'.repeat(64)}')`)).rejects.toThrow();
  const bad=await db.query<{ok:boolean}>('select satellite_finish_work($1,$2,$3) ok',[work.id,'44444444-4444-4444-8444-444444444444','dead']); expect(bad.rows[0].ok).toBe(false);
  await db.query("update satellite_work_items set lease_expires_at=now()-interval '1 second' where id=$1",[work.id]);
  expect((await db.query<{ok:boolean}>('select satellite_finish_work($1,$2,$3) ok',[work.id,work.lease_token,'dead'])).rows[0].ok).toBe(false);
  const recovered=(await db.query<any>('select * from satellite_claim_work($1,$2)',[vineyard,provider])).rows[0];
  expect(recovered.id).toBe(work.id); expect(recovered.lease_token).not.toBe(work.lease_token); expect(recovered.attempts).toBe(2);
  expect((await db.query<{ok:boolean}>('select satellite_finish_work($1,$2,$3) ok',[work.id,recovered.lease_token,'cancelled'])).rows[0].ok).toBe(true);
  await expect(db.exec("update satellite_acquisitions set provider_scene_id='changed'")).rejects.toThrow('immutable');
});
it('actual provider-global locking requires approved day AND month budgets and prevents overlapping reservations',async()=>{
  const reserve=`select satellite_reserve_provider($1,$2,1,1,10,100,100,1,true) token`;
  expect((await db.query<any>(reserve,[provider,vineyard])).rows[0].token).toBeNull();
  await db.exec(`INSERT INTO satellite_provider_throttle(provider) VALUES('${provider}');
    INSERT INTO satellite_provider_budget(provider,period_start,period_kind,request_limit,processing_limit,cpu_ms_limit,transfer_limit,storage_limit,hard_spend_limit,approved_at)
    VALUES('${provider}',current_date,'day',1,1,10,100,100,1,now()),('${provider}',date_trunc('month',now())::date,'month',1,1,10,100,100,1,now());`);
  const [a,b]=await Promise.all([db.query<any>(reserve,[provider,vineyard]),db.query<any>(reserve,[provider,vineyard])]);
  expect(a.rows[0].token).toBeTruthy(); expect(b.rows[0].token).toBeNull();
  expect((await db.query<any>('select satellite_release_provider($1,$2,1500) ok',[provider,a.rows[0].token])).rows[0].ok).toBe(true);
  expect((await db.query<any>(reserve,[provider,vineyard])).rows[0].token).toBeNull();
  expect((await db.query<any>('select requests_reserved from satellite_provider_budget')).rows.map(r=>Number(r.requests_reserved))).toEqual([1,1]);
});