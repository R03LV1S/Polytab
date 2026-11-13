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
  expires_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_oauth_states_expires ON oauth_states (expires_at);
