-- ════════════════════════════════════════════════════════════
-- BILLR v7.2 — Shared Offertes Migration
-- Voer dit uit in Supabase Dashboard → SQL Editor
-- EENMALIG na v7.2 update
-- ════════════════════════════════════════════════════════════

-- Tabel voor gedeelde offertes (klant kan offerte bekijken via link)
CREATE TABLE IF NOT EXISTS public.shared_offertes (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  token TEXT NOT NULL UNIQUE,
  offerte_data JSONB NOT NULL,
  settings_data JSONB,
  created_at TIMESTAMPTZ DEFAULT now(),
  expires_at TIMESTAMPTZ DEFAULT (now() + interval '90 days')
);

ALTER TABLE public.shared_offertes ENABLE ROW LEVEL SECURITY;

-- Iedereen kan lezen (klant opent link) en schrijven (app stuurt offerte)
DROP POLICY IF EXISTS "Anyone can read shared offertes" ON public.shared_offertes;
DROP POLICY IF EXISTS "Anyone can insert shared offertes" ON public.shared_offertes;
CREATE POLICY "Anyone can read shared offertes" ON public.shared_offertes FOR SELECT USING (true);
CREATE POLICY "Anyone can insert shared offertes" ON public.shared_offertes FOR INSERT WITH CHECK (true);

CREATE INDEX IF NOT EXISTS idx_shared_offertes_token ON public.shared_offertes(token);

-- Verify
SELECT 'shared_offertes' as tabel, count(*) as rows FROM public.shared_offertes;
