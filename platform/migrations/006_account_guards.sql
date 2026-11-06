SET search_path TO tidelab,public;
ALTER TABLE jobs ADD COLUMN auto_budget boolean NOT NULL DEFAULT false;
CREATE FUNCTION immutable_subscription_period() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'subscription periods are immutable'; END $$;
CREATE TRIGGER subscription_immutable BEFORE UPDATE OR DELETE ON subscription_periods FOR EACH ROW EXECUTE FUNCTION immutable_subscription_period();
INSERT INTO schema_versions(version) VALUES ('006_account_guards');
