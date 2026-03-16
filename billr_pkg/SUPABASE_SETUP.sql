-- ════════════════════════════════════════════════════════════
-- BILLR v6.8.0 — Supabase Database Setup
-- Voer dit uit in Supabase Dashboard → SQL Editor → New Query
-- ════════════════════════════════════════════════════════════

-- 1. Maak de user_data tabel aan (als die nog niet bestaat)
CREATE TABLE IF NOT EXISTS public.user_data (
  id         BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id    UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  key        TEXT NOT NULL,
  value      TEXT,
  updated_at TIMESTAMPTZ DEFAULT now(),
  
  -- Unieke combinatie: elke user heeft max 1 rij per key
  CONSTRAINT user_data_user_key_unique UNIQUE (user_id, key)
);

-- 2. Index voor snelle lookups
CREATE INDEX IF NOT EXISTS idx_user_data_user_id ON public.user_data(user_id);
CREATE INDEX IF NOT EXISTS idx_user_data_user_key ON public.user_data(user_id, key);

-- 3. Row Level Security (RLS) — KRITIEK!
-- Zonder RLS policies kan niemand lezen/schrijven
ALTER TABLE public.user_data ENABLE ROW LEVEL SECURITY;

-- Verwijder oude policies (als ze bestaan)
DROP POLICY IF EXISTS "Users can read own data"   ON public.user_data;
DROP POLICY IF EXISTS "Users can insert own data"  ON public.user_data;
DROP POLICY IF EXISTS "Users can update own data"  ON public.user_data;
DROP POLICY IF EXISTS "Users can delete own data"  ON public.user_data;

-- Maak nieuwe policies: user mag ALLEEN eigen data zien/bewerken
CREATE POLICY "Users can read own data"
  ON public.user_data FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own data"
  ON public.user_data FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own data"
  ON public.user_data FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own data"
  ON public.user_data FOR DELETE
  USING (auth.uid() = user_id);

-- 4. Verificatie — check of alles correct staat
SELECT 
  tablename, 
  rowsecurity 
FROM pg_tables 
WHERE schemaname = 'public' AND tablename = 'user_data';

-- Moet tonen: user_data | true

SELECT 
  policyname, 
  cmd 
FROM pg_policies 
WHERE tablename = 'user_data';

-- Moet tonen: 4 policies (SELECT, INSERT, UPDATE, DELETE)

-- ════════════════════════════════════════════════════════════
-- KLAAR! Je Supabase database is nu correct geconfigureerd.
-- ════════════════════════════════════════════════════════════
