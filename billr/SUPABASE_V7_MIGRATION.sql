-- ════════════════════════════════════════════════════════════
-- BILLR v7.0 — Supabase Migration
-- Voer dit uit in Supabase Dashboard → SQL Editor
-- ════════════════════════════════════════════════════════════

-- 1. Offerte views tracking (hoeveel keer geopend)
CREATE TABLE IF NOT EXISTS public.offerte_views (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  offerte_id TEXT NOT NULL,
  viewed_at TIMESTAMPTZ DEFAULT now(),
  user_agent TEXT
);

ALTER TABLE public.offerte_views ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Anyone can insert views" ON public.offerte_views;
DROP POLICY IF EXISTS "Auth users can read views" ON public.offerte_views;
CREATE POLICY "Anyone can insert views" ON public.offerte_views FOR INSERT WITH CHECK (true);
CREATE POLICY "Auth users can read views" ON public.offerte_views FOR SELECT USING (auth.uid() IS NOT NULL);

-- 2. Offerte responses (goedkeuring/afwijzing door klant)
CREATE TABLE IF NOT EXISTS public.offerte_responses (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  offerte_id TEXT NOT NULL,
  status TEXT NOT NULL,
  periode TEXT,
  opmerkingen TEXT,
  submitted_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE public.offerte_responses ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Anyone can insert responses" ON public.offerte_responses;
DROP POLICY IF EXISTS "Auth users can read responses" ON public.offerte_responses;
CREATE POLICY "Anyone can insert responses" ON public.offerte_responses FOR INSERT WITH CHECK (true);
CREATE POLICY "Auth users can read responses" ON public.offerte_responses FOR SELECT USING (auth.uid() IS NOT NULL);

-- 3. Indexes
CREATE INDEX IF NOT EXISTS idx_offerte_views_id ON public.offerte_views(offerte_id);
CREATE INDEX IF NOT EXISTS idx_offerte_responses_id ON public.offerte_responses(offerte_id);

-- Verify
SELECT 'offerte_views' as tabel, count(*) as rows FROM public.offerte_views
UNION ALL
SELECT 'offerte_responses', count(*) FROM public.offerte_responses;
