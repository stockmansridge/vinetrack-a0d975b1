import assert from 'node:assert/strict';
import scheduler from './worker.ts';
const env={SCHEDULER_ENABLED:'false',FUNCTION_ORIGIN:'https://example.supabase.co/functions/v1',MACHINE_TOKEN:'tok'};
Deno.test('disabled scheduler makes zero network calls',async()=>{
  let calls=0;const original=globalThis.fetch;globalThis.fetch=async()=>{calls++;return new Response('{}',{status:200});};
  try{await scheduler.scheduled({cron:'*/10 * * * *',scheduledTime:1760000000000},env);await scheduler.scheduled({cron:'0 2 * * *',scheduledTime:1760000000000},env);assert.equal(calls,0);}
  finally{globalThis.fetch=original;}
});
Deno.test('unknown cron trigger is rejected, never guessed',async()=>{
  await assert.rejects(()=>scheduler.scheduled({cron:'0 3 * * *',scheduledTime:1760000000000},{...env,SCHEDULER_ENABLED:'true'}),/Unrecognised cron/);
});
Deno.test('enabled scheduler posts distinct discovery and worker routes with the machine credential',async()=>{
  const seen:{url:string;auth:string;body:any}[]=[];const original=globalThis.fetch;
  globalThis.fetch=async(url:any,init:any)=>{seen.push({url:String(url),auth:init.headers.Authorization,body:JSON.parse(init.body)});return new Response(JSON.stringify({run_id:'r',provider_calls:0,no_op:true}),{status:200});};
  try{
    await scheduler.scheduled({cron:'0 2 * * *',scheduledTime:1760000000000},{...env,SCHEDULER_ENABLED:'true'});
    await scheduler.scheduled({cron:'*/10 * * * *',scheduledTime:1760000000000},{...env,SCHEDULER_ENABLED:'true'});
    assert.equal(seen[0].url,'https://example.supabase.co/functions/v1/satellite-ingestion-discover');
    assert.equal(seen[1].url,'https://example.supabase.co/functions/v1/satellite-ingestion-worker');
    assert.ok(seen.every(s=>s.auth==='Bearer tok'));
    assert.ok(seen.every(s=>s.body.vineyard_id==='fe952afe-437f-4be7-8cbf-fdd8e630411c'));
    assert.notEqual(seen[0].body.correlation_id,seen[1].body.correlation_id);
  }finally{globalThis.fetch=original;}
});
Deno.test('phase A disabled tick produces no backend receipt and no network call even with secrets present',async()=>{
  let calls=0;const original=globalThis.fetch;globalThis.fetch=async()=>{calls++;return new Response('{}',{status:200});};
  try{
    await scheduler.scheduled({cron:'0 2 * * *',scheduledTime:1760000000000},{SCHEDULER_ENABLED:'false',FUNCTION_ORIGIN:'https://example.supabase.co/functions/v1',MACHINE_TOKEN:'real-tok'});
    assert.equal(calls,0);
  }finally{globalThis.fetch=original;}
});
Deno.test('backend HTTP failure is surfaced, never swallowed',async()=>{
  const original=globalThis.fetch;globalThis.fetch=async()=>new Response('nope',{status:401});
  try{await assert.rejects(()=>scheduler.scheduled({cron:'*/10 * * * *',scheduledTime:1760000000000},{...env,SCHEDULER_ENABLED:'true'}),/HTTP 401/);}
  finally{globalThis.fetch=original;}
});
Deno.test('request carries a 70s abort timeout',async()=>{
  let signal:AbortSignal|undefined;const original=globalThis.fetch;
  globalThis.fetch=async(_u:any,init:any)=>{signal=init.signal;return new Response(JSON.stringify({run_id:'r',provider_calls:0,no_op:true}),{status:200});};
  try{await scheduler.scheduled({cron:'*/10 * * * *',scheduledTime:1760000000000},{...env,SCHEDULER_ENABLED:'true'});assert.ok(signal instanceof AbortSignal);assert.equal(signal!.aborted,false);}
  finally{globalThis.fetch=original;}
});
Deno.test('invalid configuration is rejected before any network call',async()=>{
  let calls=0;const original=globalThis.fetch;globalThis.fetch=async()=>{calls++;return new Response('{}',{status:200});};
  try{
    await assert.rejects(()=>scheduler.scheduled({cron:'*/10 * * * *',scheduledTime:1760000000000},{SCHEDULER_ENABLED:'true',FUNCTION_ORIGIN:'http://insecure.example.com',MACHINE_TOKEN:'tok'}),/Invalid scheduler configuration/);
    await assert.rejects(()=>scheduler.scheduled({cron:'*/10 * * * *',scheduledTime:1760000000000},{SCHEDULER_ENABLED:'true',FUNCTION_ORIGIN:'https://example.supabase.co/functions/v1',MACHINE_TOKEN:''}),/Invalid scheduler configuration/);
    assert.equal(calls,0);
  }finally{globalThis.fetch=original;}
});
