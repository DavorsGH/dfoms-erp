ALTER TABLE public.credit_notes ALTER COLUMN client_id DROP NOT NULL;

NOTIFY pgrst, 'reload schema';
