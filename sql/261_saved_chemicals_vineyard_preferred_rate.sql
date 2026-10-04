-- SQL 261 — Vineyard Preferred Rate on saved_chemicals (shared iOS/Android/Portal).
--
-- A vineyard's own normal operational rate for a Saved Chemical. Separate from
-- default_rates (registered-rate provenance) and never written to
-- registered_uses. Exact rate only; /ha and /100 L are never converted.
--
-- Contract (version 1):
--   { "version": 1, "value": 2.0, "unit": "L", "basis": "per_hectare", "note": null }
--   unit  ∈ L | mL | kg | g
--   basis ∈ per_hectare | per_100_litres
--   note  optional short text or null
--
-- Additive, nullable. Existing saved_chemicals RLS (vineyard role model) is
-- unchanged and governs this column like every other column on the row.

alter table public.saved_chemicals
  add column if not exists vineyard_preferred_rate jsonb;

alter table public.saved_chemicals
  drop constraint if exists saved_chemicals_vineyard_preferred_rate_shape;

alter table public.saved_chemicals
  add constraint saved_chemicals_vineyard_preferred_rate_shape check (
    vineyard_preferred_rate is null
    or (
      jsonb_typeof(vineyard_preferred_rate) = 'object'
      and (vineyard_preferred_rate->>'version') = '1'
      and jsonb_typeof(vineyard_preferred_rate->'value') = 'number'
      and (vineyard_preferred_rate->>'value')::numeric > 0
      and (vineyard_preferred_rate->>'unit') in ('L', 'mL', 'kg', 'g')
      and (vineyard_preferred_rate->>'basis') in ('per_hectare', 'per_100_litres')
      and (
        not (vineyard_preferred_rate ? 'note')
        or jsonb_typeof(vineyard_preferred_rate->'note') in ('null', 'string')
      )
    )
  );

comment on column public.saved_chemicals.vineyard_preferred_rate is
  'Vineyard operational preferred rate {version:1,value,unit(L|mL|kg|g),basis(per_hectare|per_100_litres),note}. Not a registered rate.';

notify pgrst, 'reload schema';
