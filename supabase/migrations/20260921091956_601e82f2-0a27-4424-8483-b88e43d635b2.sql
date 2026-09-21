CREATE TABLE IF NOT EXISTS public.public_form_rate_limits (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  key_hash text NOT NULL,
  form text NOT NULL,
  window_started_at timestamptz NOT NULL,
  request_count integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS public_form_rate_limits_key_window_idx
  ON public.public_form_rate_limits (key_hash, window_started_at);

CREATE INDEX IF NOT EXISTS public_form_rate_limits_window_idx
  ON public.public_form_rate_limits (window_started_at);

GRANT ALL ON public.public_form_rate_limits TO service_role;

ALTER TABLE public.public_form_rate_limits ENABLE ROW LEVEL SECURITY;