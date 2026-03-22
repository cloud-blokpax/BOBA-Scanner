-- Reference images: one per card, selected from the best user scan
CREATE TABLE IF NOT EXISTS card_reference_images (
    card_id text PRIMARY KEY REFERENCES cards(id),
    image_path text NOT NULL,        -- Supabase Storage path (e.g., "references/BFA-5.jpg")
    phash text,                       -- Perceptual hash of the reference image
    phash_256 text,                   -- 256-bit pHash for higher accuracy
    confidence float NOT NULL,        -- Confidence of the scan that produced this image
    contributed_by uuid,              -- User who submitted the best scan (nullable for privacy)
    created_at timestamptz DEFAULT now(),
    updated_at timestamptz DEFAULT now()
);

-- Index for quick lookup by phash
CREATE INDEX IF NOT EXISTS idx_ref_images_phash ON card_reference_images (phash);

-- RLS: anyone can read (for matching), only server can write
ALTER TABLE card_reference_images ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Anyone can read reference images" ON card_reference_images FOR SELECT USING (true);
-- Writes go through the service role (server-side only)
