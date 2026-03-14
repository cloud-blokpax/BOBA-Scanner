-- ============================================================
-- Tournament Registrations & User Profile Extensions
-- ============================================================

-- Add requirement columns to tournaments table
ALTER TABLE tournaments
  ADD COLUMN IF NOT EXISTS require_email   BOOLEAN DEFAULT true,
  ADD COLUMN IF NOT EXISTS require_name    BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS require_discord BOOLEAN DEFAULT false;

-- Tournament registrations table — stores participant info and deck CSV
CREATE TABLE IF NOT EXISTS tournament_registrations (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tournament_id   UUID REFERENCES tournaments(id) ON DELETE CASCADE NOT NULL,
  user_id         UUID REFERENCES users(id) ON DELETE SET NULL,
  email           TEXT NOT NULL,
  name            TEXT,
  discord_id      TEXT,
  deck_csv        TEXT,
  created_at      TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_tournament_reg_tournament ON tournament_registrations(tournament_id);
CREATE INDEX IF NOT EXISTS idx_tournament_reg_user       ON tournament_registrations(user_id);

-- Unique constraint: one registration per user per tournament
CREATE UNIQUE INDEX IF NOT EXISTS idx_tournament_reg_unique
  ON tournament_registrations(tournament_id, email);

-- Disable RLS (app-level auth like all other tables)
ALTER TABLE tournament_registrations DISABLE ROW LEVEL SECURITY;
