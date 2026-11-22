-- Creator self-serve wallet claims (TikTok/OAuth verified identity + wallet proof)
-- Run once. Check first: SELECT name FROM sqlite_master WHERE type='table' AND name='creator_claims';
CREATE TABLE IF NOT EXISTS creator_claims (
  project_id TEXT PRIMARY KEY,
  provider TEXT NOT NULL,
  blinded_user_hash TEXT NOT NULL,
  account_label TEXT,
  account_url TEXT,
  wallet TEXT NOT NULL,
  signature TEXT,
  signed_message TEXT,
  status TEXT NOT NULL DEFAULT 'verified',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_creator_claims_wallet ON creator_claims (wallet);
