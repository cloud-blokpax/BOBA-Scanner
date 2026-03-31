-- Add nav_config JSONB column to users table
-- Stores bottom navigation item order and visibility preferences
ALTER TABLE public.users
    ADD COLUMN IF NOT EXISTS nav_config JSONB DEFAULT NULL;

COMMENT ON COLUMN public.users.nav_config IS 'Bottom nav customization: { visible: string[] } — ordered list of visible nav item IDs';
