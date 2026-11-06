SET search_path TO tidelab,public;

-- No rewrite of historical task JSON: absent platform continues to mean TikTok.
ALTER TABLE connections DROP CONSTRAINT connections_kind_check;
ALTER TABLE connections ADD CONSTRAINT connections_kind_check CHECK(kind IN ('model','fastmoss','sellersprite','1688'));
ALTER TABLE api_resource_groups DROP CONSTRAINT api_resource_groups_kind_check;
ALTER TABLE api_resource_groups ADD CONSTRAINT api_resource_groups_kind_check CHECK(kind IN ('model','fastmoss','sellersprite','1688'));
DROP INDEX opportunity_identity;
CREATE UNIQUE INDEX opportunity_identity ON records(workspace_id,(COALESCE(data->>'platform','tiktok')),(CASE WHEN data->>'platform'='amazon' THEN COALESCE(data->>'market','US') ELSE '' END),(data->>'product_id')) WHERE kind='opportunity';

INSERT INTO schema_versions(version) VALUES('010_amazon_scouting');
