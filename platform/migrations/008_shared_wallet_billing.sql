SET search_path TO tidelab,public;

ALTER TABLE jobs
  ADD COLUMN billing_mode text NOT NULL DEFAULT 'job_reservation'
  CHECK (billing_mode IN ('job_reservation','wallet_per_call'));

ALTER TABLE jobs DROP CONSTRAINT job_budget_bounds;
ALTER TABLE jobs ADD CONSTRAINT job_budget_bounds CHECK (
  model_spent >= 0 AND model_inflight >= 0 AND
  data_spent >= 0 AND data_inflight >= 0 AND
  (
    billing_mode = 'wallet_per_call' OR
    (
      model_spent + model_inflight <= model_budget AND
      data_spent + data_inflight <= data_budget
    )
  )
);

INSERT INTO schema_versions(version) VALUES('008_shared_wallet_billing');
