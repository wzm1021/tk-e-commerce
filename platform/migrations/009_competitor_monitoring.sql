SET search_path TO tidelab,public;

CREATE TABLE shop_monitors (
  id uuid PRIMARY KEY, workspace_id uuid NOT NULL REFERENCES workspaces(id),
  created_by uuid NOT NULL REFERENCES users(id), name text NOT NULL,
  seller_id text NOT NULL CHECK(seller_id ~ '^[0-9]{1,40}$'), market text NOT NULL,
  status text NOT NULL DEFAULT 'active' CHECK(status IN ('active','paused','archived')),
  config jsonb NOT NULL, state jsonb NOT NULL DEFAULT '{}', version integer NOT NULL DEFAULT 1,
  last_job_id uuid, last_error text, last_completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(workspace_id,id), FOREIGN KEY(workspace_id,last_job_id) REFERENCES jobs(workspace_id,id)
);
CREATE UNIQUE INDEX monitor_shop_identity ON shop_monitors(workspace_id,seller_id,market) WHERE status<>'archived';

-- Only routing IDs and due time are global, like dispatch. Config and business data remain under RLS.
CREATE TABLE monitor_schedule (
  monitor_id uuid PRIMARY KEY, workspace_id uuid NOT NULL, due_at timestamptz NOT NULL,
  FOREIGN KEY(workspace_id,monitor_id) REFERENCES shop_monitors(workspace_id,id)
);
CREATE INDEX monitor_schedule_due ON monitor_schedule(due_at);

CREATE TABLE monitor_runs (
  job_id uuid PRIMARY KEY, workspace_id uuid NOT NULL,
  monitor_id uuid NOT NULL, trigger text NOT NULL CHECK(trigger IN ('manual','scheduled')),
  snapshot jsonb, created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY(workspace_id,job_id) REFERENCES jobs(workspace_id,id),
  FOREIGN KEY(workspace_id,monitor_id) REFERENCES shop_monitors(workspace_id,id),
  UNIQUE(workspace_id,monitor_id,job_id)
);
CREATE INDEX monitor_runs_recent ON monitor_runs(workspace_id,monitor_id,created_at DESC);

CREATE TABLE monitor_requests (
  workspace_id uuid NOT NULL, monitor_id uuid NOT NULL, request_key text NOT NULL, job_id uuid NOT NULL,
  PRIMARY KEY(workspace_id,monitor_id,request_key),
  FOREIGN KEY(workspace_id,monitor_id,job_id) REFERENCES monitor_runs(workspace_id,monitor_id,job_id)
);

CREATE TABLE monitor_events (
  id uuid PRIMARY KEY, workspace_id uuid NOT NULL, monitor_id uuid NOT NULL, job_id uuid NOT NULL,
  event_key text NOT NULL, kind text NOT NULL, data jsonb NOT NULL,
  read_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY(workspace_id,monitor_id,job_id) REFERENCES monitor_runs(workspace_id,monitor_id,job_id),
  UNIQUE(workspace_id,monitor_id,event_key)
);
CREATE INDEX monitor_events_recent ON monitor_events(workspace_id,created_at DESC);
CREATE INDEX monitor_events_unread ON monitor_events(workspace_id,monitor_id) WHERE read_at IS NULL;

DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['shop_monitors','monitor_runs','monitor_requests','monitor_events'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY',t);
    EXECUTE format('CREATE POLICY tenant_scope ON %I USING (workspace_id = nullif(current_setting(''app.workspace_id'',true),'''')::uuid) WITH CHECK (workspace_id = nullif(current_setting(''app.workspace_id'',true),'''')::uuid)',t);
  END LOOP;
END $$;
INSERT INTO schema_versions(version) VALUES('009_competitor_monitoring');
