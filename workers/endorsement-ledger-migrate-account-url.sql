-- Add optional private account reference/URL for verified endorsements (not exposed by public API)
ALTER TABLE endorsements ADD COLUMN account_url TEXT;
ALTER TABLE endorsements ADD COLUMN account_label TEXT;
