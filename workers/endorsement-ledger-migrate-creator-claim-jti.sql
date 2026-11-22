-- Single-use jti for creator claim tokens
CREATE TABLE IF NOT EXISTS creator_claim_token_uses (
  jti TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  used_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_creator_claim_token_uses_expires ON creator_claim_token_uses (expires_at);
