SET search_path TO tidelab,public;
-- Ledger history is immutable. Old entries retain scale 1; new data entries use tenths.
ALTER TABLE ledger ADD COLUMN data_unit_scale smallint NOT NULL DEFAULT 1 CHECK(data_unit_scale IN(1,10));
ALTER TABLE ledger ALTER COLUMN data_unit_scale SET DEFAULT 10;
DO $$ DECLARE w uuid; BEGIN
 FOR w IN SELECT id FROM workspaces LOOP
  PERFORM set_config('app.workspace_id',w::text,true);
  UPDATE wallets SET available=available*10,reserved=reserved*10 WHERE currency='data_points' AND workspace_id=w;
  UPDATE jobs SET data_budget=data_budget*10,data_spent=data_spent*10,data_inflight=data_inflight*10 WHERE workspace_id=w;
  UPDATE invocations SET reserved=reserved*10,charged=charged*10,procurement=procurement*10 WHERE kind='data' AND workspace_id=w;
 END LOOP;
END $$;
SELECT set_config('app.workspace_id','',true);

CREATE TABLE api_resource_groups (
 key text PRIMARY KEY, kind text NOT NULL CHECK(kind IN('model','fastmoss','1688')),
 max_concurrent integer NOT NULL CHECK(max_concurrent BETWEEN 1 AND 100),
 max_per_workspace integer NOT NULL CHECK(max_per_workspace BETWEEN 1 AND max_concurrent),
 queue_limit integer NOT NULL DEFAULT 100 CHECK(queue_limit BETWEEN 1 AND 1000),
 requests_per_minute integer NOT NULL CHECK(requests_per_minute BETWEEN 1 AND 10000),
 cooldown_until timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE api_resource_tickets (
 id uuid PRIMARY KEY, resource_key text NOT NULL REFERENCES api_resource_groups(key),
 workspace_id uuid NOT NULL REFERENCES workspaces(id),
 state text NOT NULL CHECK(state IN('queued','active','done')),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),started_at timestamptz,
 expires_at timestamptz NOT NULL
);
CREATE INDEX resource_queue ON api_resource_tickets(resource_key,state,created_at,id);
CREATE INDEX resource_rate ON api_resource_tickets(resource_key,started_at) WHERE started_at IS NOT NULL;
ALTER TABLE connections ADD COLUMN resource_key text REFERENCES api_resource_groups(key);
ALTER TABLE connections ADD COLUMN share_market_snapshots boolean NOT NULL DEFAULT false;
-- Existing FastMoss connections are platform-owned public market data. Future connections opt in explicitly.
UPDATE connections SET share_market_snapshots=true WHERE kind='fastmoss';

CREATE TABLE data_cache_policies (
 tool text PRIMARY KEY,ttl_seconds integer NOT NULL CHECK(ttl_seconds BETWEEN 0 AND 86400),
 updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO data_cache_policies(tool,ttl_seconds) VALUES('*',900);
CREATE TABLE data_fetches (
 id uuid PRIMARY KEY,cache_key text NOT NULL,connection_id uuid NOT NULL REFERENCES connections(id),
 scope_workspace_id uuid REFERENCES workspaces(id),owner_workspace_id uuid NOT NULL REFERENCES workspaces(id),
 tool text NOT NULL,arguments jsonb NOT NULL,schema_digest text NOT NULL,
 state text NOT NULL CHECK(state IN('queued','started','succeeded','failed','uncertain','aborted')),
 invocation_id uuid,created_at timestamptz NOT NULL DEFAULT now(),expires_at timestamptz NOT NULL,
 completed_at timestamptz,error_code text
);
CREATE UNIQUE INDEX data_one_pending ON data_fetches(cache_key) WHERE state IN('queued','started','uncertain');
CREATE UNIQUE INDEX data_fetch_invocation ON data_fetches(invocation_id) WHERE invocation_id IS NOT NULL;
CREATE INDEX data_fetch_history ON data_fetches(connection_id,created_at DESC,id);
CREATE TABLE data_provider_responses (
 id uuid PRIMARY KEY,fetch_id uuid NOT NULL REFERENCES data_fetches(id),
 http_status integer NOT NULL,body text NOT NULL,captured_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX data_response_fetch ON data_provider_responses(fetch_id);
CREATE TABLE data_snapshots (
 id uuid PRIMARY KEY,fetch_id uuid NOT NULL UNIQUE REFERENCES data_fetches(id),cache_key text NOT NULL,
 connection_id uuid NOT NULL REFERENCES connections(id),scope_workspace_id uuid REFERENCES workspaces(id),
 tool text NOT NULL,payload jsonb NOT NULL,sha256 text NOT NULL,
 captured_at timestamptz NOT NULL,expires_at timestamptz NOT NULL,
 reusable boolean NOT NULL,size_bytes bigint NOT NULL CHECK(size_bytes>=0)
);
CREATE INDEX data_snapshot_lookup ON data_snapshots(cache_key,captured_at DESC) WHERE reusable;
CREATE INDEX data_snapshot_history ON data_snapshots(connection_id,captured_at DESC,id);
CREATE TRIGGER data_snapshot_immutable BEFORE UPDATE OR DELETE ON data_snapshots FOR EACH ROW EXECUTE FUNCTION immutable_record();
CREATE TRIGGER data_response_immutable BEFORE UPDATE OR DELETE ON data_provider_responses FOR EACH ROW EXECUTE FUNCTION immutable_record();
CREATE TABLE data_usage_daily (
 day date NOT NULL DEFAULT current_date,connection_id uuid NOT NULL REFERENCES connections(id),
 live_calls bigint NOT NULL DEFAULT 0,cache_hits bigint NOT NULL DEFAULT 0,
 charged_units bigint NOT NULL DEFAULT 0,PRIMARY KEY(day,connection_id)
);
-- The API server explicitly enables the admin context only behind admin authentication.
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['data_fetches','data_snapshots'] LOOP
  EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',t);
  EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY',t);
  EXECUTE format('CREATE POLICY data_scope ON %I USING (
    current_setting(''app.platform_admin'',true)=''true'' OR
    ((scope_workspace_id IS NULL OR scope_workspace_id=NULLIF(current_setting(''app.workspace_id'',true),'''')::uuid)
     AND EXISTS(SELECT 1 FROM workspace_connections w WHERE w.connection_id=%I.connection_id AND w.enabled
       AND w.workspace_id=NULLIF(current_setting(''app.workspace_id'',true),'''')::uuid))
   )',t,t);
 END LOOP;
END $$;
-- An owner must be able to persist an in-flight response even if access is revoked mid-call.
CREATE POLICY fetch_owner ON data_fetches USING (owner_workspace_id=NULLIF(current_setting('app.workspace_id',true),'')::uuid);
CREATE POLICY snapshot_owner ON data_snapshots USING (EXISTS(SELECT 1 FROM data_fetches f WHERE f.id=fetch_id AND f.owner_workspace_id=NULLIF(current_setting('app.workspace_id',true),'')::uuid));
ALTER TABLE data_provider_responses ENABLE ROW LEVEL SECURITY;
ALTER TABLE data_provider_responses FORCE ROW LEVEL SECURITY;
CREATE POLICY response_scope ON data_provider_responses USING (EXISTS(SELECT 1 FROM data_fetches f WHERE f.id=fetch_id));
INSERT INTO platform_audit(action,target_id,summary) VALUES('billing.unit_migration','004_shared_data','{"data_storage_scale":10,"historical_ledger_preserved":true}');
INSERT INTO schema_versions(version) VALUES('004_shared_data');
