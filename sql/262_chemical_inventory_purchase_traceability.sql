-- 262: Chemical inventory purchase traceability (organic records).
-- OWNER: Rork. This is the ONE shared change for batch date + serial number —
-- iOS/Android/Portal must not ship competing migrations.
--
-- Checked live on 2026-10-04: chemical_inventory_record_purchase_v2 does NOT yet
-- accept p_batch_date / p_serial_number (PGRST202). The Portal now sends both
-- (NULL when blank), so Portal purchases fail until this is run.

-- 1. Columns (batch_number already exists and stays the Batch / Lot number).
ALTER TABLE public.chemical_inventory_purchases
  ADD COLUMN IF NOT EXISTS batch_date    date NULL,
  ADD COLUMN IF NOT EXISTS serial_number text NULL;

-- 2. chemical_inventory_record_purchase_v2 — Rork to apply to the EXISTING body
--    (not reproduced here because the Portal does not have it):
--    * DROP the current 12-argument signature first, then CREATE OR REPLACE with
--      the same arguments plus, at the end:
--        p_batch_date    date DEFAULT NULL,
--        p_serial_number text DEFAULT NULL
--      so there is exactly one signature (no PostgREST overload ambiguity) and
--      released clients sending only the old arguments still resolve.
--    * INSERT batch_date = p_batch_date, serial_number = NULLIF(btrim(p_serial_number), '').
--    * Re-apply the existing GRANT EXECUTE to authenticated.
--    * No change to quantity, container maths, unit cost or stock calculations.
--
-- 3. chemical_inventory_purchase_history_v2 — add batch_date, serial_number to
--    the returned columns. Never merge rows; never delete history on Finished /
--    zero stock (organic retention is at least five years).
--
-- 4. chemical_inventory_summary — alongside latest_batch_number, return nullable
--    latest_batch_date and latest_serial_number from the same latest purchase.
--
-- Rork: confirm the purchases table name above matches the live schema.
