-- ============================================
-- WBP Productivity - Schema Supabase
-- Execute este SQL no Supabase SQL Editor
-- ============================================

-- Organizacoes (multi-tenant)
CREATE TABLE organizations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  slug TEXT UNIQUE NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Usuarios com roles
CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  auth_id UUID UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  org_id UUID REFERENCES organizations(id),
  email TEXT NOT NULL,
  name TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('operacao', 'cs', 'gestao')),
  trello_member_id TEXT,
  clients TEXT[] DEFAULT '{}',
  active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Conexoes Trello (por organizacao)
CREATE TABLE trello_connections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
  trello_api_key TEXT NOT NULL,
  trello_token TEXT NOT NULL,
  board_ids TEXT[] DEFAULT '{}',
  board_names JSONB DEFAULT '{}',
  connected_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Cards sincronizados do Trello
CREATE TABLE cards (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID REFERENCES organizations(id),
  trello_card_id TEXT NOT NULL,
  board_id TEXT NOT NULL,
  board_name TEXT,
  title TEXT NOT NULL,
  description TEXT,
  list_name TEXT,
  client TEXT,
  category TEXT,
  subcategory TEXT,
  assigned_to TEXT[] DEFAULT '{}',
  assigned_names TEXT[] DEFAULT '{}',
  status TEXT DEFAULT 'active' CHECK (status IN ('active', 'completed', 'archived')),
  created_at TIMESTAMPTZ NOT NULL,
  completed_at TIMESTAMPTZ,
  due_date TIMESTAMPTZ,
  labels JSONB DEFAULT '[]',
  time_to_complete_hours NUMERIC,
  last_synced_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(org_id, trello_card_id)
);

-- Historico de movimentacao de cards
CREATE TABLE card_movements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  card_id UUID REFERENCES cards(id) ON DELETE CASCADE,
  org_id UUID REFERENCES organizations(id),
  from_list TEXT,
  to_list TEXT,
  moved_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indices para performance
CREATE INDEX idx_cards_org ON cards(org_id);
CREATE INDEX idx_cards_client ON cards(org_id, client);
CREATE INDEX idx_cards_category ON cards(org_id, category);
CREATE INDEX idx_cards_status ON cards(org_id, status);
CREATE INDEX idx_cards_assigned ON cards USING GIN(assigned_to);
CREATE INDEX idx_cards_created ON cards(org_id, created_at);
CREATE INDEX idx_cards_completed ON cards(org_id, completed_at);
CREATE INDEX idx_movements_card ON card_movements(card_id);
CREATE INDEX idx_users_org ON users(org_id);
CREATE INDEX idx_users_auth ON users(auth_id);

-- Row Level Security
ALTER TABLE organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE trello_connections ENABLE ROW LEVEL SECURITY;
ALTER TABLE cards ENABLE ROW LEVEL SECURITY;
ALTER TABLE card_movements ENABLE ROW LEVEL SECURITY;

-- Policies: usuarios so veem dados da propria organizacao
CREATE POLICY "Users see own org" ON users FOR SELECT USING (
  org_id = (SELECT org_id FROM users WHERE auth_id = auth.uid())
);

CREATE POLICY "Cards by org" ON cards FOR ALL USING (
  org_id = (SELECT org_id FROM users WHERE auth_id = auth.uid())
);

CREATE POLICY "Movements by org" ON card_movements FOR ALL USING (
  org_id = (SELECT org_id FROM users WHERE auth_id = auth.uid())
);

CREATE POLICY "Connections by org" ON trello_connections FOR ALL USING (
  org_id = (SELECT org_id FROM users WHERE auth_id = auth.uid())
);

CREATE POLICY "Org members" ON organizations FOR SELECT USING (
  id = (SELECT org_id FROM users WHERE auth_id = auth.uid())
);

-- Funcao para calcular tempo de conclusao
CREATE OR REPLACE FUNCTION update_completion_time()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.completed_at IS NOT NULL AND OLD.completed_at IS NULL THEN
    NEW.time_to_complete_hours = EXTRACT(EPOCH FROM (NEW.completed_at - NEW.created_at)) / 3600;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER calc_completion_time
BEFORE UPDATE ON cards
FOR EACH ROW EXECUTE FUNCTION update_completion_time();

-- Inserir organizacao WBP inicial
INSERT INTO organizations (name, slug) VALUES ('Agência WBP', 'wbp');
