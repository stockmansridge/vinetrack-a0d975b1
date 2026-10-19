interface Environment {SCHEDULER_ENABLED:string;FUNCTION_ORIGIN:string;MACHINE_TOKEN:string}
export default {
  async scheduled(event:{cron:string;scheduledTime:number},env:Environment) {
    if(env.SCHEDULER_ENABLED!=='true') return;
    const origin=new URL(env.FUNCTION_ORIGIN);
    if(origin.protocol!=='https:'||origin.username||origin.password||origin.search||origin.hash||!env.MACHINE_TOKEN) throw new Error('Invalid scheduler configuration');
    const kind=event.cron==='0 2 * * *'?'discovery':'worker';
    const hash=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(`${kind}:${event.scheduledTime}`));
    const h=[...new Uint8Array(hash)].map(v=>v.toString(16).padStart(2,'0')).join('');
    const correlation=`${h.slice(0,8)}-${h.slice(8,12)}-4${h.slice(13,16)}-8${h.slice(17,20)}-${h.slice(20,32)}`;
    const name=kind==='worker'?'satellite-ingestion-worker':'satellite-ingestion-discover';
    const res=await fetch(env.FUNCTION_ORIGIN.replace(/\/$/,'')+'/'+name,{method:'POST',redirect:'error',signal:AbortSignal.timeout(70000),headers:{Authorization:`Bearer ${env.MACHINE_TOKEN}`,'Content-Type':'application/json'},body:JSON.stringify({correlation_id:correlation,vineyard_id:'fe952afe-437f-4be7-8cbf-fdd8e630411c'})});
    const body=await res.json() as {run_id?:string;provider_calls?:number;no_op?:boolean};
    if(!res.ok) throw new Error(`Scheduler callback HTTP ${res.status}`);
    console.log(JSON.stringify({run_id:body.run_id,provider_calls:body.provider_calls,no_op:body.no_op}));
  },
};