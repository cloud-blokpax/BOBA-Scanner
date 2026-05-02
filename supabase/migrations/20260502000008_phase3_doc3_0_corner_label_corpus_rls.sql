ALTER TABLE public.detector_training_labels ENABLE ROW LEVEL SECURITY;

CREATE POLICY admin_select_detector_labels ON public.detector_training_labels
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.users u WHERE u.id = auth.uid() AND u.is_admin = true));

CREATE POLICY admin_insert_detector_labels ON public.detector_training_labels
  FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM public.users u WHERE u.id = auth.uid() AND u.is_admin = true));

CREATE POLICY admin_update_detector_labels ON public.detector_training_labels
  FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.users u WHERE u.id = auth.uid() AND u.is_admin = true));
