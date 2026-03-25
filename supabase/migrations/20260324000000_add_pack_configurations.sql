-- Pack Simulator Configuration Table
-- Stores admin-managed pull rate configurations for virtual pack openings

CREATE TABLE IF NOT EXISTS pack_configurations (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,

    -- Which box/product this config is for
    box_type TEXT NOT NULL,          -- 'blaster' | 'double_mega' | 'hobby' | 'jumbo'
    set_code TEXT NOT NULL,          -- 'alpha' | '2026_griffey' | 'alpha_update' | 'alpha_blast' etc.
    display_name TEXT NOT NULL,      -- 'Hobby Box — 2026 Griffey Set'

    -- Pack contents: 10 slots, each with weighted pull rates
    slots JSONB NOT NULL DEFAULT '[]'::jsonb,

    -- Pack metadata
    packs_per_box INTEGER NOT NULL DEFAULT 20,
    msrp_cents INTEGER,              -- Box MSRP in cents

    -- Admin metadata
    is_active BOOLEAN NOT NULL DEFAULT true,
    updated_at TIMESTAMPTZ DEFAULT now(),
    updated_by UUID REFERENCES auth.users(id)
);

-- Index for active configs
CREATE INDEX IF NOT EXISTS idx_pack_configs_active ON pack_configurations(is_active, box_type);

-- RLS: anyone can read active configs, only admins can write
ALTER TABLE pack_configurations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can read active pack configs"
    ON pack_configurations FOR SELECT
    USING (is_active = true);

CREATE POLICY "Admins can manage pack configs"
    ON pack_configurations FOR ALL
    USING (
        EXISTS (
            SELECT 1 FROM users
            WHERE users.auth_user_id = auth.uid()
            AND users.is_admin = true
        )
    );
