# VineTrack Crop Health pilot scheduler (Stockman's Ridge only)

Unattended dispatch for the two Lovable Cloud functions
`satellite-ingestion-discover` (daily 02:00 UTC) and
`satellite-ingestion-worker` (every 10 minutes UTC). Cloudflare Workers Builds
supports a monorepo root directory, so this subdirectory deploys directly from
the repository — no blocker.

## Phases

- **Phase A — cron tick/log only (default).** `SCHEDULER_ENABLED = "false"` in
  `wrangler.toml`. Cloudflare fires the crons and the handler logs one JSON
  line per tick, then returns **before any network call**. There is no HTTP
  request and no `satellite_ingest_runs` backend receipt in this phase. Do not
  describe phase A output as an "HTTP 200" or a database receipt.
- **Phase B — machine-authenticated backend receipts (owner decision).** After
  the runtime secrets below exist and all five backend
  `satellite_ingestion_control` kill switches are independently confirmed OFF,
  the owner sets `SCHEDULER_ENABLED = "true"` and redeploys. The worker then
  POSTs to the functions with the machine credential; because the backend
  gates are OFF, the backend returns idle/`no_op: true` with
  `provider_calls: 0` and records the receipt. Actually enabling the backend
  ingestion gates is a **separate future decision**, never part of scheduler
  setup.

## One-time owner deployment (dashboard only)

1. Cloudflare dashboard → **Workers & Pages → Create → Import repository** →
   `stockmansridge/vinetrack-a0d975b1`, production branch `main`.
2. Project name **must be** `vinetrack-satellite-pilot-scheduler` (matches
   `name` in `wrangler.toml`).
3. **Root directory:** `scheduler/satellite-pilot`.
4. **Build command:** none. **Deploy command:** `npx wrangler deploy`.
5. Add **runtime** secrets (Settings → Variables and Secrets → Type: Secret —
   not build-time variables):
   - `FUNCTION_ORIGIN` = `https://qpgkkertfwdycjhcbnpf.supabase.co/functions/v1`
     (project ref verified from `supabase/config.toml`).
   - `MACHINE_TOKEN` = a fresh rotated token — see rotation below.
6. Deploy. Phase A is immediately active: cron ticks appear in the worker's
   logs with zero outbound requests.

CLI alternative: from `scheduler/satellite-pilot/`, run
`wrangler secret put FUNCTION_ORIGIN`, `wrangler secret put MACHINE_TOKEN`,
then `wrangler deploy`.

This worker is independent of the existing `region-beacon` (GetStampd) and
`vinetrackwebsite` Workers — different name, routes, and secrets; no
interaction.

## Machine token rotation (do this before phase B)

The current Lovable Cloud `SATELLITE_MACHINE_TOKEN` is write-only and cannot
be exported — never try to retrieve or copy it, and never paste any token
value into chat, source, or logs. To rotate safely:

1. Generate a fresh high-entropy token locally
   (e.g. `openssl rand -hex 32`).
2. Save it in Lovable **Project Settings → Secrets** as
   `SATELLITE_MACHINE_TOKEN` (overwrites the old value).
3. Save the same value as the Cloudflare runtime secret `MACHINE_TOKEN`
   (`wrangler secret put MACHINE_TOKEN` or the dashboard).
4. The old token is immediately invalid; nothing else references it.

## Phase B checklist (owner approval required)

1. Confirm all five `satellite_ingestion_control` rows are `enabled: false`.
2. Set `SCHEDULER_ENABLED = "true"` in `wrangler.toml`, redeploy.
3. Verify each receipt shows `no_op: true` and `provider_calls: 0`.
4. Leave the backend gates OFF. Enabling them is a separate approved step.
