SET search_path TO tidelab,public;
ALTER TABLE ai_test_dispatch DROP CONSTRAINT ai_test_dispatch_kind_check;
ALTER TABLE ai_test_dispatch ADD CONSTRAINT ai_test_dispatch_kind_check CHECK(kind IN('capture','run','suggestion'));
CREATE TABLE ai_test_suggestions (
 id uuid PRIMARY KEY, workspace_id uuid NOT NULL, draft_id uuid NOT NULL, arm text NOT NULL,
 created_by uuid NOT NULL REFERENCES users(id), source_digest text NOT NULL, input_digest text NOT NULL,
 attempt integer NOT NULL DEFAULT 1, state text NOT NULL CHECK(state IN('queued','generating','ready','failed')),
 request jsonb NOT NULL, result jsonb, artifact_id uuid, error_code text,
 usage jsonb, procurement_micro_cny bigint, applied jsonb NOT NULL DEFAULT '{}',
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(workspace_id,draft_id,arm,input_digest,attempt),
 FOREIGN KEY(workspace_id,draft_id) REFERENCES ai_test_drafts(workspace_id,id),
 FOREIGN KEY(workspace_id,artifact_id) REFERENCES artifacts(workspace_id,id)
);
CREATE INDEX ai_test_suggestions_draft ON ai_test_suggestions(workspace_id,draft_id,created_at DESC);
ALTER TABLE ai_test_suggestions ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_test_suggestions FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_scope ON ai_test_suggestions USING (workspace_id = NULLIF(current_setting('app.workspace_id',true),'')::uuid) WITH CHECK (workspace_id = NULLIF(current_setting('app.workspace_id',true),'')::uuid);
INSERT INTO schema_versions(version) VALUES ('014_ai_test_suggestions');
