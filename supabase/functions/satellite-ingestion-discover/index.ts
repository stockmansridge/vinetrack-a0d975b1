import { handleMachine } from '../_shared/satellite-ingestion-runtime.ts';
Deno.serve((req) => handleMachine(req, 'discovery'));