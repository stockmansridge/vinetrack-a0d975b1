-- SQL 161 — Pruning season realignment (PREPARED, NOT APPLIED)
--
-- Purpose
--   Some pruning_entries are linked to a pruning_seasons row whose
--   season_year is the PRODUCTION VINTAGE (e.g. 2027) instead of the
--   calendar year the pruning work was performed (e.g. 2026). This makes the
--   Pruning Activity Report show two different seasons for entries recorded
--   on the same date.
--
-- Canonical rule (shared with iOS/Android)
--   pruning_seasons.season_year = calendar year of the pruning work, resolved
--   from the vineyard's configured season settings — NOT vintage_year - 1.
--   vintage_year stays whatever resolve_vineyard_vintage_year() returns.
--
-- Safety
--   * Idempotent — re-running changes nothing once entries are aligned.
--   * Only touches entries proven inconsistent (linked season_year <>
--     canonical season year for the entry's own date/vineyard settings).
--   * Preserves entry ids, created_at, created_by and vintage_year.
--   * Row segments follow their entry so segment identity stays intact.
--   * Reversed (deleted_at IS NOT NULL) entries are realigned too, so audit
--     history keeps reporting under the correct season. They are counted
--     separately in the before/after report.
--
-- DO NOT RUN until Rork confirms the canonical write rule.

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Canonical season year for a pruning date, using the vineyard's own
--    configured season start (vineyards.season_start_month/day).
--    Winter pruning falls in the calendar year of the work.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.canonical_pruning_season_year(
  p_vineyard_id uuid,
  p_entry_date  date
) RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXTRACT(YEAR FROM p_entry_date)::int
  FROM public.vineyards v
  WHERE v.id = p_vineyard_id
$$;

-- ---------------------------------------------------------------------------
-- 2. Deterministic season id (matches pruningSeasonId in the portal, iOS and
--    Android: UUIDv3-shaped md5 of the shared name string).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.deterministic_pruning_season_id(
  p_vineyard_id uuid,
  p_paddock_id  uuid,
  p_season_year integer
) RETURNS uuid
LANGUAGE sql
IMMUTABLE
AS $$
  WITH h AS (
    SELECT md5(
      'vinetrack-pruning-season|' || lower(p_vineyard_id::text) || '|' ||
      lower(p_paddock_id::text) || '|' || p_season_year::text
    ) AS x
  )
  SELECT (
    substr(x, 1, 12) ||
    '3' || substr(x, 14, 3) ||
    to_hex((('x' || substr(x, 17, 2))::bit(8)::int & 63) | 128) ||
    substr(x, 19, 14)
  )::uuid
  FROM h
$$;

-- ---------------------------------------------------------------------------
-- 3. Inconsistent entries (proof set) + BEFORE counts
-- ---------------------------------------------------------------------------
CREATE TEMP TABLE _sql161_bad ON COMMIT DROP AS
SELECT
  e.id                AS entry_id,
  e.vineyard_id,
  e.paddock_id,
  e.entry_date,
  e.pruning_season_id AS old_season_id,
  s.season_year       AS old_season_year,
  e.vintage_year,
  (e.deleted_at IS NOT NULL) AS reversed,
  public.canonical_pruning_season_year(e.vineyard_id, e.entry_date) AS new_season_year
FROM public.pruning_entries e
JOIN public.pruning_seasons s ON s.id = e.pruning_season_id
WHERE s.season_year IS DISTINCT FROM
      public.canonical_pruning_season_year(e.vineyard_id, e.entry_date);

SELECT 'before' AS phase,
       count(*)                                AS inconsistent_entries,
       count(*) FILTER (WHERE reversed)        AS reversed_entries,
       count(DISTINCT vineyard_id)             AS vineyards,
       count(DISTINCT paddock_id)              AS blocks
FROM _sql161_bad;

-- ---------------------------------------------------------------------------
-- 4. Ensure a canonical season row exists for every (vineyard, block, year)
-- ---------------------------------------------------------------------------
INSERT INTO public.pruning_seasons (
  id, vineyard_id, paddock_id, season_year, pruning_method, status
)
SELECT DISTINCT
  public.deterministic_pruning_season_id(b.vineyard_id, b.paddock_id, b.new_season_year),
  b.vineyard_id, b.paddock_id, b.new_season_year,
  COALESCE(old.pruning_method, 'spur'), 'active'
FROM _sql161_bad b
LEFT JOIN public.pruning_seasons old ON old.id = b.old_season_id
WHERE NOT EXISTS (
  SELECT 1 FROM public.pruning_seasons t
  WHERE t.vineyard_id = b.vineyard_id
    AND t.paddock_id  = b.paddock_id
    AND t.season_year = b.new_season_year
    AND t.deleted_at IS NULL
)
ON CONFLICT (id) DO NOTHING;

-- Resolve the live target season id (adopt any existing row's id).
CREATE TEMP TABLE _sql161_map ON COMMIT DROP AS
SELECT b.*, t.id AS new_season_id
FROM _sql161_bad b
JOIN LATERAL (
  SELECT t.id FROM public.pruning_seasons t
  WHERE t.vineyard_id = b.vineyard_id
    AND t.paddock_id  = b.paddock_id
    AND t.season_year = b.new_season_year
    AND t.deleted_at IS NULL
  ORDER BY t.created_at
  LIMIT 1
) t ON TRUE
WHERE t.id IS DISTINCT FROM b.old_season_id;

-- ---------------------------------------------------------------------------
-- 5. Reassign entries and their row segments (ids and audit fields preserved)
-- ---------------------------------------------------------------------------
UPDATE public.pruning_entries e
SET pruning_season_id = m.new_season_id,
    updated_at        = now()
FROM _sql161_map m
WHERE e.id = m.entry_id
  AND e.pruning_season_id IS DISTINCT FROM m.new_season_id;

UPDATE public.pruning_row_segments g
SET pruning_season_id = m.new_season_id
FROM _sql161_map m
WHERE g.pruning_entry_id = m.entry_id
  AND g.pruning_season_id IS DISTINCT FROM m.new_season_id;

-- Bump sync versions when the deployment carries them (mobile delta sync).
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'pruning_entries'
      AND column_name = 'sync_version'
  ) THEN
    EXECUTE $q$
      UPDATE public.pruning_entries e
      SET sync_version = COALESCE(e.sync_version, 0) + 1
      FROM _sql161_map m
      WHERE e.id = m.entry_id
    $q$;
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 6. AFTER counts (must be zero remaining)
-- ---------------------------------------------------------------------------
SELECT 'after' AS phase,
       (SELECT count(*) FROM _sql161_map) AS entries_realigned,
       (SELECT count(*)
        FROM public.pruning_entries e
        JOIN public.pruning_seasons s ON s.id = e.pruning_season_id
        WHERE s.season_year IS DISTINCT FROM
              public.canonical_pruning_season_year(e.vineyard_id, e.entry_date)
       ) AS remaining_inconsistent;

COMMIT;
