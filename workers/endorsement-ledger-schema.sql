-- D1 schema for verifiable social-account endorsement ledger
-- Apply with: wrangler d1 execute <DB_NAME> --file=endorsement-ledger-schema.sql

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS endorsements (
  project_id TEXT NOT NULL,
  provider TEXT NOT NULL,
  blinded_user_hash TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (project_id, provider, blinded_user_hash)
);

CREATE INDEX IF NOT EXISTS idx_endorsements_project ON endorsements (project_id);

CREATE TABLE IF NOT EXISTS oauth_states (
  state_nonce TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  provider TEXT NOT NULL,
  code_verifier TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  return_to TEXT
);

CREATE INDEX IF NOT EXISTS idx_oauth_states_expires ON oauth_states (expires_at);

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

CREATE TABLE IF NOT EXISTS creator_claim_token_uses (
  jti TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  used_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_creator_claim_token_uses_expires ON creator_claim_token_uses (expires_at);
