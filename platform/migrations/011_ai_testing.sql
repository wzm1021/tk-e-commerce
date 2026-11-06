SET search_path TO tidelab,public;
CREATE TABLE ai_test_accounts (
 id uuid PRIMARY KEY, name text NOT NULL, owner_identity text NOT NULL UNIQUE,
 secret_ref uuid NOT NULL, secret_version uuid NOT NULL, credential_hash text NOT NULL UNIQUE, enabled boolean NOT NULL DEFAULT false,
 verified boolean NOT NULL DEFAULT false, trial_limit integer NOT NULL DEFAULT 6 CHECK(trial_limit>=0),
 trial_used integer CHECK(trial_used>=0), monthly_limit integer NOT NULL DEFAULT 150 CHECK(monthly_limit>=0),
 monthly_used integer NOT NULL DEFAULT 0 CHECK(monthly_used>=0), quota_month text NOT NULL,
 priority integer NOT NULL DEFAULT 100, state text NOT NULL DEFAULT 'pending',
 cooldown_until timestamptz, checked_at timestamptz, note text NOT NULL DEFAULT '',
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE ai_test_drafts (
 id uuid PRIMARY KEY, workspace_id uuid NOT NULL REFERENCES workspaces(id), created_by uuid NOT NULL REFERENCES users(id),
 version integer NOT NULL DEFAULT 1, data jsonb NOT NULL, sources jsonb NOT NULL DEFAULT '{}',
 import_key text, confirmed_digest text, confirmed_by uuid, confirmed_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(workspace_id,id), UNIQUE(workspace_id,import_key)
);
CREATE TABLE ai_test_images (
 id uuid PRIMARY KEY, workspace_id uuid NOT NULL, draft_id uuid NOT NULL, arm text NOT NULL,
 state text NOT NULL CHECK(state IN('queued','processing','ready','failed')),
 request jsonb NOT NULL, artifact_id uuid, full_artifact_id uuid, metadata jsonb NOT NULL DEFAULT '{}', error_code text,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(workspace_id,id), FOREIGN KEY(workspace_id,draft_id) REFERENCES ai_test_drafts(workspace_id,id),
 FOREIGN KEY(workspace_id,artifact_id) REFERENCES artifacts(workspace_id,id),
 FOREIGN KEY(workspace_id,full_artifact_id) REFERENCES artifacts(workspace_id,id)
);
CREATE TABLE ai_test_runs (
 id uuid PRIMARY KEY, workspace_id uuid NOT NULL, draft_id uuid NOT NULL, created_by uuid NOT NULL,
 confirmation_digest text NOT NULL, snapshot jsonb NOT NULL, status text NOT NULL,
 cancel_requested boolean NOT NULL DEFAULT false, attempt integer NOT NULL DEFAULT 0,
 account_id uuid REFERENCES ai_test_accounts(id), remote_id text, sdk_key text,
 progress jsonb, result_artifact_id uuid, result jsonb, error_code text,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(workspace_id,id), UNIQUE(workspace_id,draft_id,confirmation_digest),
 FOREIGN KEY(workspace_id,draft_id) REFERENCES ai_test_drafts(workspace_id,id),
 FOREIGN KEY(workspace_id,result_artifact_id) REFERENCES artifacts(workspace_id,id)
);
-- Global queues and reservations contain routing/accounting metadata only, never product inputs or results.
CREATE TABLE ai_test_dispatch (
 id uuid PRIMARY KEY, workspace_id uuid NOT NULL REFERENCES workspaces(id), kind text NOT NULL CHECK(kind IN('capture','run')),
 available_at timestamptz NOT NULL DEFAULT now(), lease_token uuid, lease_until timestamptz
);
CREATE TABLE ai_test_reservations (
 id uuid PRIMARY KEY, workspace_id uuid NOT NULL, run_id uuid NOT NULL, account_id uuid NOT NULL REFERENCES ai_test_accounts(id),
 attempt integer NOT NULL, credits integer NOT NULL CHECK(credits>0), quota_month text NOT NULL,
 state text NOT NULL CHECK(state IN('reserved','started','uncertain','settled','released')),
 trial_counted boolean NOT NULL DEFAULT false, creation_attempted boolean NOT NULL DEFAULT false, charged integer, secret_ref uuid NOT NULL, secret_version uuid NOT NULL,
 sdk_key text NOT NULL UNIQUE, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(run_id,attempt), FOREIGN KEY(workspace_id,run_id) REFERENCES ai_test_runs(workspace_id,id)
);
CREATE TABLE ai_test_events (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, workspace_id uuid NOT NULL, run_id uuid NOT NULL,
 kind text NOT NULL, detail jsonb NOT NULL DEFAULT '{}', created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(workspace_id,run_id) REFERENCES ai_test_runs(workspace_id,id)
);
CREATE INDEX ai_test_dispatch_due ON ai_test_dispatch(available_at);
CREATE INDEX ai_test_reservations_account ON ai_test_reservations(account_id,state);
CREATE INDEX ai_test_runs_workspace ON ai_test_runs(workspace_id,created_at DESC);
CREATE TRIGGER ai_test_events_immutable BEFORE UPDATE OR DELETE ON ai_test_events FOR EACH ROW EXECUTE FUNCTION immutable_record();
CREATE FUNCTION immutable_ai_test_snapshot() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF NEW.snapshot IS DISTINCT FROM OLD.snapshot OR NEW.confirmation_digest IS DISTINCT FROM OLD.confirmation_digest OR NEW.draft_id IS DISTINCT FROM OLD.draft_id OR NEW.created_by IS DISTINCT FROM OLD.created_by OR NEW.workspace_id IS DISTINCT FROM OLD.workspace_id THEN
  RAISE EXCEPTION 'confirmed test snapshot is immutable' USING ERRCODE='42501';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER ai_test_run_snapshot_immutable BEFORE UPDATE ON ai_test_runs FOR EACH ROW EXECUTE FUNCTION immutable_ai_test_snapshot();
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['ai_test_drafts','ai_test_images','ai_test_runs','ai_test_events'] LOOP
  EXECUTE format('ALTER TABLE tidelab.%I ENABLE ROW LEVEL SECURITY',t);
  EXECUTE format('ALTER TABLE tidelab.%I FORCE ROW LEVEL SECURITY',t);
  EXECUTE format('CREATE POLICY tenant_scope ON tidelab.%I USING (workspace_id = NULLIF(current_setting(''app.workspace_id'',true),'''')::uuid) WITH CHECK (workspace_id = NULLIF(current_setting(''app.workspace_id'',true),'''')::uuid)',t);
 END LOOP;
END $$;
INSERT INTO schema_versions(version) VALUES ('011_ai_testing');
