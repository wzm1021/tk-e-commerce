SET search_path TO tidelab,public;
ALTER TABLE wallets DROP CONSTRAINT wallets_currency_check;
ALTER TABLE wallets ADD CONSTRAINT wallets_currency_check CHECK(currency IN('model_micro_cny','data_points','ai_test_uses'));
DO $$ DECLARE w uuid; BEGIN
 FOR w IN SELECT id FROM workspaces LOOP
  PERFORM set_config('app.workspace_id',w::text,true);
  INSERT INTO wallets(workspace_id,currency) VALUES(w,'ai_test_uses') ON CONFLICT DO NOTHING;
 END LOOP;
END $$;
SELECT set_config('app.workspace_id','',true);
-- Existing runs keep their original billing agreement; never retroactively charge.
ALTER TABLE ai_test_runs ADD COLUMN quota_state text NOT NULL DEFAULT 'legacy'
 CHECK(quota_state IN('legacy','reserved','charged','released'));
ALTER TABLE ai_test_drafts ADD COLUMN archived_at timestamptz;
INSERT INTO schema_versions(version) VALUES('013_ai_test_quota');
