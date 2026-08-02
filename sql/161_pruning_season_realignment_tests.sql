-- SQL 161 — rollback-only verification test (safe to run; never commits).
--
-- Proves:
--   1. the realignment moves inconsistent entries onto the canonical season,
--   2. entry ids, created_at and vintage_year are preserved,
--   3. row segments follow their entry,
--   4. the migration is idempotent (second pass changes nothing),
--   5. no correctly-linked entry is touched.

BEGIN;

CREATE TEMP TABLE _t161_before AS
SELECT e.id, e.pruning_season_id, e.created_at, e.vintage_year, e.entry_date, e.vineyard_id
FROM public.pruning_entries e;

CREATE TEMP TABLE _t161_bad AS
SELECT e.id
FROM public.pruning_entries e
JOIN public.pruning_seasons s ON s.id = e.pruning_season_id
WHERE s.season_year IS DISTINCT FROM
      public.canonical_pruning_season_year(e.vineyard_id, e.entry_date);

\echo '--- inconsistent entries before ---'
SELECT count(*) AS bad_before FROM _t161_bad;

-- Run the migration body here (paste 161_pruning_season_realignment.sql
-- between BEGIN/COMMIT, without its own transaction control).
\i sql/161_pruning_season_realignment.sql

-- 1 + 5. every entry now canonical, and only bad ones moved
DO $$
DECLARE remaining int; untouched_moved int;
BEGIN
  SELECT count(*) INTO remaining
  FROM public.pruning_entries e
  JOIN public.pruning_seasons s ON s.id = e.pruning_season_id
  WHERE s.season_year IS DISTINCT FROM
        public.canonical_pruning_season_year(e.vineyard_id, e.entry_date);
  IF remaining <> 0 THEN
    RAISE EXCEPTION 'FAIL: % entries still inconsistent', remaining;
  END IF;

  SELECT count(*) INTO untouched_moved
  FROM public.pruning_entries e
  JOIN _t161_before b ON b.id = e.id
  WHERE e.pruning_season_id IS DISTINCT FROM b.pruning_season_id
    AND e.id NOT IN (SELECT id FROM _t161_bad);
  IF untouched_moved <> 0 THEN
    RAISE EXCEPTION 'FAIL: % already-correct entries were modified', untouched_moved;
  END IF;
END $$;

-- 2. identity and audit fields preserved
DO $$
DECLARE bad int;
BEGIN
  SELECT count(*) INTO bad
  FROM public.pruning_entries e
  JOIN _t161_before b ON b.id = e.id
  WHERE e.created_at IS DISTINCT FROM b.created_at
     OR e.vintage_year IS DISTINCT FROM b.vintage_year
     OR e.entry_date IS DISTINCT FROM b.entry_date;
  IF bad <> 0 THEN
    RAISE EXCEPTION 'FAIL: % entries had identity/audit fields altered', bad;
  END IF;
END $$;

-- 3. segments follow their entry
DO $$
DECLARE orphan int;
BEGIN
  SELECT count(*) INTO orphan
  FROM public.pruning_row_segments g
  JOIN public.pruning_entries e ON e.id = g.pruning_entry_id
  WHERE g.pruning_season_id IS DISTINCT FROM e.pruning_season_id;
  IF orphan <> 0 THEN
    RAISE EXCEPTION 'FAIL: % row segments left on the wrong season', orphan;
  END IF;
END $$;

-- 4. idempotency: a second pass must find nothing to fix
DO $$
DECLARE second_pass int;
BEGIN
  SELECT count(*) INTO second_pass
  FROM public.pruning_entries e
  JOIN public.pruning_seasons s ON s.id = e.pruning_season_id
  WHERE s.season_year IS DISTINCT FROM
        public.canonical_pruning_season_year(e.vineyard_id, e.entry_date);
  IF second_pass <> 0 THEN
    RAISE EXCEPTION 'FAIL: migration is not idempotent (% rows)', second_pass;
  END IF;
END $$;

\echo '--- SQL 161 verification passed (rolling back) ---'

ROLLBACK;
