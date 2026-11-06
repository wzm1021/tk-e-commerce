SET search_path TO tidelab,public;
ALTER TABLE users ADD COLUMN email text, ADD COLUMN email_verified_at timestamptz;
CREATE UNIQUE INDEX users_email_unique ON users(lower(email)) WHERE email IS NOT NULL;
ALTER TABLE workspaces ADD COLUMN kind text NOT NULL DEFAULT 'team' CHECK(kind IN ('personal','team')),
 ADD COLUMN subscription_required boolean NOT NULL DEFAULT false;
ALTER TABLE memberships DROP CONSTRAINT memberships_role_check;
ALTER TABLE memberships ADD CONSTRAINT memberships_role_check CHECK(role IN ('owner','admin','member'));
ALTER TABLE memberships ADD COLUMN default_model_id uuid REFERENCES connections(id);
CREATE INDEX memberships_workspace ON memberships(workspace_id,user_id);
ALTER TABLE connections ADD COLUMN signup_default boolean NOT NULL DEFAULT false;
ALTER TABLE jobs ADD COLUMN requested_model_id uuid REFERENCES connections(id), ADD COLUMN submission_hash text;
CREATE INDEX jobs_workspace_creator_date ON jobs(workspace_id,created_by,created_at);

CREATE TABLE email_challenges (
 id uuid PRIMARY KEY,email text NOT NULL,purpose text NOT NULL CHECK(purpose IN ('register','reset','bind')),
 user_id uuid REFERENCES users(id),code_hash text NOT NULL,attempts integer NOT NULL DEFAULT 0 CHECK(attempts BETWEEN 0 AND 5),
 created_at timestamptz NOT NULL DEFAULT now(),expires_at timestamptz NOT NULL,sent_at timestamptz,consumed_at timestamptz
);
CREATE INDEX email_challenges_target ON email_challenges(email,purpose,created_at DESC);
CREATE INDEX email_challenges_expiry ON email_challenges(expires_at);
CREATE TABLE mail_settings (
 id boolean PRIMARY KEY DEFAULT true CHECK(id),version_id uuid NOT NULL,
 config jsonb NOT NULL,secret_ref text NOT NULL,enabled boolean NOT NULL DEFAULT false,
 updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE subscription_periods (
 id uuid PRIMARY KEY,workspace_id uuid NOT NULL REFERENCES workspaces(id),actor_id uuid NOT NULL REFERENCES users(id),
 reference text NOT NULL UNIQUE,kind text NOT NULL CHECK(kind IN ('paid','trial')),
 starts_at timestamptz NOT NULL,ends_at timestamptz NOT NULL CHECK(ends_at>starts_at),
 seat_limit integer NOT NULL CHECK(seat_limit BETWEEN 1 AND 200),
 model_credit bigint NOT NULL CHECK(model_credit>=0),data_credit bigint NOT NULL CHECK(data_credit>=0),
 fee_micro_cny bigint NOT NULL CHECK(fee_micro_cny>=0),terms jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),UNIQUE(workspace_id,id)
);
ALTER TABLE workspaces ADD COLUMN subscription_id uuid;
ALTER TABLE workspaces ADD CONSTRAINT workspace_subscription FOREIGN KEY(id,subscription_id) REFERENCES subscription_periods(workspace_id,id);
ALTER TABLE subscription_periods ENABLE ROW LEVEL SECURITY;
ALTER TABLE subscription_periods FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_scope ON subscription_periods USING (workspace_id=NULLIF(current_setting('app.workspace_id',true),'')::uuid) WITH CHECK (workspace_id=NULLIF(current_setting('app.workspace_id',true),'')::uuid);
CREATE INDEX subscription_workspace_date ON subscription_periods(workspace_id,created_at DESC);
CREATE INDEX invocation_workspace_date ON invocations(workspace_id,created_at,kind);
INSERT INTO schema_versions(version) VALUES ('005_accounts_teams');
