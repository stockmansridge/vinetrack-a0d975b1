-- 040_paddock_row_length_overrides.sql
-- ---------------------------------------------------------------------------
-- Adds per-row length overrides to public.paddocks for CALCULATION/REPORTING
-- use only (vine count, post count, emitter count, dripper-line length, etc.).
--
-- IMPORTANT — operational behaviour MUST NOT change:
--   * Live Trip row tracking, row guidance, row completion, pin placement,
--     and map geometry continue to use the existing operational geometry
--     (paddocks.rows / paddocks.boundary / related path logic).
--   * This column is read ONLY by the portal's setup-calculation pipeline
--     (deriveMetrics) and by the CSV import/export tools.
--   * iOS does not need to read this field for trip operation.
--
-- JSON SHAPE
-- ----------
-- A JSON object whose keys are the row identifier (rowNumber, matching the
-- iOS `row.number` / `rowNumber` field — decimals are allowed for half-rows)
-- and whose values are the override length in metres (positive number).
--
-- Example:
--   {
--     "1":   245.0,
--     "2":   244.2,
--     "3.5": 243.8
--   }
--
-- This matches the existing CSV column `row_lengths_override_m`, which is
-- serialised as the compact form `1:245;2:244.2;3.5:243.8`. Keys are stored
-- as strings (JSON object keys must be strings); the portal parses them back
-- to numbers via Number(key). Decimal keys are permitted to mirror the iOS
-- rowNumber convention.
--
-- Rules enforced by the portal (not the database):
--   * length values must be > 0
--   * duplicate keys are rejected at import time
--   * an empty/absent column on import does NOT clear existing values; an
--     explicit clear requires the dedicated UI action
-- ---------------------------------------------------------------------------

ALTER TABLE public.paddocks
  ADD COLUMN IF NOT EXISTS row_length_overrides jsonb NULL;

COMMENT ON COLUMN public.paddocks.row_length_overrides IS
  'Per-row length overrides in metres for setup CALCULATIONS only '
  '(vine/post/emitter counts, dripper line length). Object keyed by row '
  'number as string (decimals allowed, e.g. "3.5"); value is length in '
  'metres (>0). Example: {"1":245,"2":244.2,"3.5":243.8}. MUST NOT affect '
  'operational geometry, Live Trip row tracking, row guidance, row '
  'completion, pins, or map geometry — those continue to use paddocks.rows '
  'and related path data. Populated/edited via the portal CSV import or '
  'paddock setup UI; not backfilled.';

-- No RLS changes required: the column inherits all existing policies on
-- public.paddocks.
-- No backfill: existing paddocks remain NULL until edited.
-- No changes to geometry columns (boundary, rows, etc.).
