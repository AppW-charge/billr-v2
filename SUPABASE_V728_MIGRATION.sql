-- ═══ BILLR v7.2.8 MIGRATION ═══
-- Run this in Supabase SQL Editor

-- 1. Add referrer column to offerte_views (optional tracking)
ALTER TABLE offerte_views ADD COLUMN IF NOT EXISTS referrer text;

-- 2. Ensure offerte_views has proper index for fast lookups
CREATE INDEX IF NOT EXISTS idx_offerte_views_offerte_id ON offerte_views(offerte_id);
CREATE INDEX IF NOT EXISTS idx_offerte_views_viewed_at ON offerte_views(viewed_at DESC);

-- 3. Ensure RLS policies allow anon reads of offerte_views per offerte_id
-- (needed for OfferteViewStats component)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'offerte_views' AND policyname = 'anon_read_views'
  ) THEN
    CREATE POLICY anon_read_views ON offerte_views FOR SELECT USING (true);
  END IF;
END $$;

-- 4. Ensure shared_offertes settings_data can store email config
-- (already JSONB, no schema change needed — just a note)
-- settings_data now includes: bedrijf, sjabloon, layout, voorwaarden, thema, email

SELECT 'v7.2.8 migration complete' AS status;
