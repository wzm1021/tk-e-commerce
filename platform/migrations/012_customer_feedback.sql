SET search_path TO tidelab,public;
CREATE TABLE customer_profiles (
 user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE, data jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE customer_activity (
 user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE, day date NOT NULL,
 sessions integer NOT NULL DEFAULT 0, interactions integer NOT NULL DEFAULT 0,
 first_at timestamptz NOT NULL, last_at timestamptz NOT NULL,
 PRIMARY KEY(user_id,day)
);
CREATE TABLE customer_activity_clock (
 user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE, last_at timestamptz NOT NULL
);
CREATE TABLE customer_feedback (
 id uuid PRIMARY KEY, user_id uuid NOT NULL REFERENCES users(id), workspace_id uuid REFERENCES workspaces(id),
 email_snapshot text NOT NULL, contact_snapshot jsonb NOT NULL,
 category text NOT NULL CHECK(category IN('problem','data','suggestion','other')),
 title text NOT NULL, description text NOT NULL, context jsonb,
 status text NOT NULL DEFAULT 'new' CHECK(status IN('new','processing','resolved','closed')),
 public_reply text NOT NULL DEFAULT '', submission_digest text NOT NULL,
 notification_planned_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(user_id,id)
);
CREATE TABLE feedback_files (
 id uuid PRIMARY KEY, user_id uuid NOT NULL REFERENCES users(id), feedback_id uuid,
 object_key text NOT NULL, sha256 text NOT NULL, size_bytes integer NOT NULL CHECK(size_bytes>0 AND size_bytes<=5242880),
 name text NOT NULL, mime text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(user_id,feedback_id) REFERENCES customer_feedback(user_id,id)
);
CREATE TABLE feedback_mail_settings (
 id boolean PRIMARY KEY DEFAULT true CHECK(id), enabled boolean NOT NULL DEFAULT false,
 owner_email text NOT NULL, sales_emails jsonb NOT NULL,
 updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE feedback_deliveries (
 id uuid PRIMARY KEY, feedback_id uuid REFERENCES customer_feedback(id), recipient text NOT NULL,
 kind text NOT NULL DEFAULT 'feedback' CHECK(kind IN('feedback','test')),
 state text NOT NULL DEFAULT 'pending' CHECK(state IN('pending','sending','accepted','failed','uncertain')),
 attempts integer NOT NULL DEFAULT 0, available_at timestamptz NOT NULL DEFAULT now(),
 lease_until timestamptz, lease_token uuid, error_code text, message_id text,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(feedback_id,recipient)
);
CREATE INDEX customer_feedback_user ON customer_feedback(user_id,created_at DESC);
CREATE INDEX customer_feedback_pending ON customer_feedback(created_at) WHERE notification_planned_at IS NULL;
CREATE INDEX feedback_files_pending ON feedback_files(user_id,created_at) WHERE feedback_id IS NULL;
CREATE INDEX feedback_delivery_due ON feedback_deliveries(state,available_at);
CREATE INDEX customer_job_owner ON jobs(created_by,created_at);
CREATE INDEX customer_record_owner ON records(created_by,kind,created_at);
CREATE INDEX customer_test_owner ON ai_test_runs(created_by,created_at);
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['customer_profiles','customer_activity','customer_activity_clock','customer_feedback','feedback_files'] LOOP
  EXECUTE format('ALTER TABLE tidelab.%I ENABLE ROW LEVEL SECURITY',t);
  EXECUTE format('ALTER TABLE tidelab.%I FORCE ROW LEVEL SECURITY',t);
  EXECUTE format('CREATE POLICY account_scope ON tidelab.%I USING (user_id=NULLIF(current_setting(''app.account_id'',true),'''')::uuid OR current_setting(''app.customer_admin'',true)=''true'') WITH CHECK (user_id=NULLIF(current_setting(''app.account_id'',true),'''')::uuid OR current_setting(''app.customer_admin'',true)=''true'')',t);
 END LOOP;
END $$;
INSERT INTO schema_versions(version) VALUES ('012_customer_feedback');
