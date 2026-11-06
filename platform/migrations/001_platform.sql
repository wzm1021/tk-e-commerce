CREATE SCHEMA IF NOT EXISTS tidelab;
SET search_path TO tidelab,public;
CREATE TABLE IF NOT EXISTS schema_versions(version text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE users (
 id uuid PRIMARY KEY, login text UNIQUE NOT NULL, password_hash text NOT NULL,
 display_name text NOT NULL, is_admin boolean NOT NULL DEFAULT false, enabled boolean NOT NULL DEFAULT true,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE workspaces(id uuid PRIMARY KEY,name text NOT NULL,enabled boolean NOT NULL DEFAULT true,created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE memberships(user_id uuid REFERENCES users(id),workspace_id uuid REFERENCES workspaces(id),role text NOT NULL CHECK(role IN('owner','member')),PRIMARY KEY(user_id,workspace_id));
CREATE TABLE sessions(token_hash text PRIMARY KEY,user_id uuid NOT NULL REFERENCES users(id),audience text NOT NULL CHECK(audience IN('web','admin')),csrf_hash text NOT NULL,expires_at timestamptz NOT NULL,created_at timestamptz NOT NULL DEFAULT now());
CREATE INDEX sessions_expiry ON sessions(expires_at);
CREATE TABLE connections(id uuid PRIMARY KEY,name text NOT NULL,kind text NOT NULL CHECK(kind IN('model','fastmoss','1688')),active_version_id uuid,generation integer NOT NULL DEFAULT 0,enabled boolean NOT NULL DEFAULT false,created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE connection_versions(id uuid PRIMARY KEY,connection_id uuid NOT NULL REFERENCES connections(id),config jsonb NOT NULL,secret_ref text NOT NULL,verified boolean NOT NULL DEFAULT false,validation jsonb NOT NULL DEFAULT '{}',created_at timestamptz NOT NULL DEFAULT now(),UNIQUE(connection_id,id));
ALTER TABLE connections ADD CONSTRAINT active_connection_version FOREIGN KEY(id,active_version_id) REFERENCES connection_versions(connection_id,id);
CREATE TABLE workspace_connections(workspace_id uuid REFERENCES workspaces(id),connection_id uuid REFERENCES connections(id),enabled boolean NOT NULL DEFAULT true,PRIMARY KEY(workspace_id,connection_id));
CREATE TABLE price_cards(id uuid PRIMARY KEY,connection_id uuid NOT NULL REFERENCES connections(id),name text NOT NULL,data jsonb NOT NULL,active boolean NOT NULL DEFAULT false,created_at timestamptz NOT NULL DEFAULT now());
CREATE UNIQUE INDEX price_card_active ON price_cards(connection_id) WHERE active;
CREATE TABLE dispatch(job_id uuid PRIMARY KEY,workspace_id uuid NOT NULL REFERENCES workspaces(id),available_at timestamptz NOT NULL DEFAULT now(),created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE platform_audit(id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,actor_id uuid,action text NOT NULL,target_id text,summary jsonb NOT NULL DEFAULT '{}',created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE records (
 id uuid PRIMARY KEY,workspace_id uuid NOT NULL REFERENCES workspaces(id),kind text NOT NULL,
 data jsonb NOT NULL,version integer NOT NULL DEFAULT 1,created_by uuid REFERENCES users(id),
 created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(workspace_id,id)
);
CREATE INDEX records_workspace_kind ON records(workspace_id,kind,updated_at DESC);
CREATE TABLE wallets(workspace_id uuid REFERENCES workspaces(id),currency text CHECK(currency IN('model_micro_cny','data_points')),available bigint NOT NULL DEFAULT 0 CHECK(available>=0),reserved bigint NOT NULL DEFAULT 0 CHECK(reserved>=0),PRIMARY KEY(workspace_id,currency));
CREATE TABLE ledger(id uuid PRIMARY KEY,workspace_id uuid NOT NULL REFERENCES workspaces(id),currency text NOT NULL,operation text NOT NULL,amount bigint NOT NULL CHECK(amount>=0),reference text NOT NULL,detail jsonb NOT NULL DEFAULT '{}',created_at timestamptz NOT NULL DEFAULT now(),UNIQUE(workspace_id,currency,operation,reference));
CREATE INDEX ledger_workspace_date ON ledger(workspace_id,created_at DESC);
CREATE TABLE artifacts(id uuid PRIMARY KEY,workspace_id uuid NOT NULL REFERENCES workspaces(id),object_key text NOT NULL UNIQUE,sha256 text NOT NULL,mime text NOT NULL,size_bytes bigint NOT NULL CHECK(size_bytes>=0),kind text NOT NULL,name text NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),UNIQUE(workspace_id,id));
CREATE INDEX artifacts_workspace_date ON artifacts(workspace_id,created_at DESC);
CREATE TABLE skill_releases(id uuid PRIMARY KEY,workspace_id uuid NOT NULL REFERENCES workspaces(id),skill_id text NOT NULL,version integer NOT NULL,artifact_id uuid NOT NULL,digest text NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),UNIQUE(workspace_id,skill_id,version),UNIQUE(workspace_id,id),FOREIGN KEY(workspace_id,artifact_id) REFERENCES artifacts(workspace_id,id));
CREATE TABLE skill_bindings(workspace_id uuid NOT NULL REFERENCES workspaces(id),skill_id text NOT NULL,release_id uuid NOT NULL,generation integer NOT NULL DEFAULT 1,PRIMARY KEY(workspace_id,skill_id),FOREIGN KEY(workspace_id,release_id) REFERENCES skill_releases(workspace_id,id));
CREATE TABLE jobs (
 id uuid PRIMARY KEY,workspace_id uuid NOT NULL REFERENCES workspaces(id),created_by uuid NOT NULL REFERENCES users(id),
 kind text NOT NULL,title text NOT NULL,request jsonb NOT NULL,snapshot jsonb,digest text,
 status text NOT NULL CHECK(status IN('awaiting_connection','queued','running','waiting_input','succeeded','partial','failed','cancelled','reconciling')),
 idempotency_key text NOT NULL,model_budget bigint NOT NULL DEFAULT 0 CHECK(model_budget>=0),data_budget bigint NOT NULL DEFAULT 0 CHECK(data_budget>=0),
 model_spent bigint NOT NULL DEFAULT 0,model_inflight bigint NOT NULL DEFAULT 0,data_spent bigint NOT NULL DEFAULT 0,data_inflight bigint NOT NULL DEFAULT 0,
 fence bigint NOT NULL DEFAULT 0,worker_id text,lease_expires_at timestamptz,attempt integer NOT NULL DEFAULT 0,
 stage text NOT NULL DEFAULT 'resolve',checkpoint jsonb NOT NULL DEFAULT '{}',result jsonb,error_code text,
 created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(workspace_id,id),UNIQUE(workspace_id,idempotency_key)
);
ALTER TABLE dispatch ADD CONSTRAINT dispatch_job FOREIGN KEY(workspace_id,job_id) REFERENCES jobs(workspace_id,id);
CREATE INDEX jobs_workspace_date ON jobs(workspace_id,created_at DESC);
CREATE INDEX jobs_lease ON jobs(lease_expires_at) WHERE status='running';
CREATE TABLE job_events(id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,workspace_id uuid NOT NULL,job_id uuid NOT NULL,kind text NOT NULL,summary text NOT NULL,data jsonb NOT NULL DEFAULT '{}',created_at timestamptz NOT NULL DEFAULT now(),FOREIGN KEY(workspace_id,job_id) REFERENCES jobs(workspace_id,id));
CREATE INDEX job_events_timeline ON job_events(workspace_id,job_id,id);
CREATE TABLE invocations(id uuid PRIMARY KEY,workspace_id uuid NOT NULL,job_id uuid NOT NULL,operation_key text NOT NULL,kind text NOT NULL CHECK(kind IN('model','data')),state text NOT NULL CHECK(state IN('started','succeeded','reconciling','rejected')),reserved bigint NOT NULL,charged bigint NOT NULL DEFAULT 0,procurement bigint NOT NULL DEFAULT 0,usage jsonb,artifact_id uuid,provider_request_id text,created_at timestamptz NOT NULL DEFAULT now(),UNIQUE(workspace_id,job_id,operation_key),FOREIGN KEY(workspace_id,job_id) REFERENCES jobs(workspace_id,id),FOREIGN KEY(workspace_id,artifact_id) REFERENCES artifacts(workspace_id,id));
CREATE INDEX invocation_job ON invocations(workspace_id,job_id);
CREATE TABLE tenant_audit(id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,workspace_id uuid NOT NULL REFERENCES workspaces(id),actor_id uuid,action text NOT NULL,target_id text,summary jsonb NOT NULL DEFAULT '{}',created_at timestamptz NOT NULL DEFAULT now());
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['records','wallets','ledger','artifacts','skill_releases','skill_bindings','jobs','job_events','invocations','tenant_audit'] LOOP
  EXECUTE format('ALTER TABLE tidelab.%I ENABLE ROW LEVEL SECURITY',t);
  EXECUTE format('ALTER TABLE tidelab.%I FORCE ROW LEVEL SECURITY',t);
  EXECUTE format('CREATE POLICY tenant_scope ON tidelab.%I USING (workspace_id = NULLIF(current_setting(''app.workspace_id'',true),'''')::uuid) WITH CHECK (workspace_id = NULLIF(current_setting(''app.workspace_id'',true),'''')::uuid)',t);
 END LOOP;
END $$;
INSERT INTO schema_versions(version) VALUES ('001_platform');
