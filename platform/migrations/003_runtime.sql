SET search_path TO tidelab,public;
ALTER TABLE jobs ADD COLUMN cancel_requested boolean NOT NULL DEFAULT false;
CREATE TABLE worker_nodes(id text PRIMARY KEY,last_seen timestamptz NOT NULL DEFAULT now(),version text NOT NULL,active_job uuid);
INSERT INTO schema_versions(version) VALUES('003_runtime');
