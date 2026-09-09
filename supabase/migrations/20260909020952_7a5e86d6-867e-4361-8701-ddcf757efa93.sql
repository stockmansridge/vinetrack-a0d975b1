CREATE TABLE public.portal_notices (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  tone TEXT NOT NULL DEFAULT 'info',
  priority INTEGER NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT true,
  starts_at TIMESTAMPTZ,
  ends_at TIMESTAMPTZ,
  created_by UUID,
  created_by_email TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT ON public.portal_notices TO anon;
GRANT SELECT ON public.portal_notices TO authenticated;
GRANT ALL ON public.portal_notices TO service_role;

ALTER TABLE public.portal_notices ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Portal notices are readable by everyone"
ON public.portal_notices FOR SELECT
USING (true);

CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

CREATE TRIGGER update_portal_notices_updated_at
BEFORE UPDATE ON public.portal_notices
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE INDEX portal_notices_active_idx ON public.portal_notices (is_active, priority DESC, created_at DESC);