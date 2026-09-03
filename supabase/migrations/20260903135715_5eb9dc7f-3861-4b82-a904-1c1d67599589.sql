CREATE TABLE public.portal_maintenance (
  id integer PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  is_enabled boolean NOT NULL DEFAULT false,
  message text NOT NULL DEFAULT 'We are currently performing system maintenance. We will be back online shortly. Thank you for your patience.',
  updated_by uuid,
  updated_by_email text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.portal_maintenance TO anon;
GRANT SELECT ON public.portal_maintenance TO authenticated;
GRANT ALL ON public.portal_maintenance TO service_role;

ALTER TABLE public.portal_maintenance ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Maintenance status is publicly readable"
  ON public.portal_maintenance
  FOR SELECT
  USING (true);

CREATE TRIGGER portal_maintenance_set_updated_at
  BEFORE UPDATE ON public.portal_maintenance
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();