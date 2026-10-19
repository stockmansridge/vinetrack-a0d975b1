CREATE TABLE public.satellite_scl_preflight (
  acquisition_id uuid NOT NULL REFERENCES public.satellite_acquisitions(id) ON DELETE RESTRICT,
  paddock_id uuid NOT NULL,
  boundary_hash text NOT NULL CHECK (boundary_hash ~ '^[a-f0-9]{64}$'),
  scl_window jsonb NOT NULL,
  scl_cells jsonb NOT NULL,
  histogram jsonb NOT NULL,
  paddock_pixels integer NOT NULL CHECK (paddock_pixels >= 0),
  valid_scl_count integer NOT NULL CHECK (valid_scl_count >= 0),
  terminal_quality text CHECK (terminal_quality IN ('cloud_obscured','insufficient_coverage')),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (acquisition_id, paddock_id, boundary_hash)
);
COMMENT ON TABLE public.satellite_scl_preflight IS 'Stockmans Ridge pilot: bounded native 20m SCL classification per immutable acquisition/paddock/boundary. Shared by NDVI and True Colour work items so the SCL band is read from the provider at most once; terminal_quality rows are deterministic and never recomputed.';
REVOKE ALL ON public.satellite_scl_preflight FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.satellite_scl_preflight TO service_role;
ALTER TABLE public.satellite_scl_preflight ENABLE ROW LEVEL SECURITY;