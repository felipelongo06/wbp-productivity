-- ============================================
-- Migration: Adicionar colunas priority e responsible
-- Execute no SQL Editor do Supabase
-- ============================================

ALTER TABLE cards ADD COLUMN IF NOT EXISTS priority TEXT DEFAULT 'neutra';
ALTER TABLE cards ADD COLUMN IF NOT EXISTS responsible TEXT;

CREATE INDEX IF NOT EXISTS idx_cards_priority ON cards(org_id, priority);
CREATE INDEX IF NOT EXISTS idx_cards_responsible ON cards(org_id, responsible);
