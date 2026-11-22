-- Add optional return_to for OAuth callback redirect (must be validated against ALLOWED_ORIGINS)
-- Run once. If rerunning on an existing DB, check first: PRAGMA table_info(oauth_states);
-- D1/SQLite ALTER TABLE ADD COLUMN has no IF NOT EXISTS; deployment script should skip when column exists.
ALTER TABLE oauth_states ADD COLUMN return_to TEXT;
