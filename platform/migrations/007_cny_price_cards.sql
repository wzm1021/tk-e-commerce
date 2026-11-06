SET search_path TO tidelab,public;

-- Append equivalent RMB cards; preserve original cards, job snapshots and ledgers.
LOCK TABLE price_cards IN SHARE ROW EXCLUSIVE MODE;
DO $$
DECLARE old_card record; new_id uuid; converted jsonb;
BEGIN
  FOR old_card IN SELECT * FROM price_cards WHERE active AND data->>'currency'='USD' FOR UPDATE LOOP
    new_id := gen_random_uuid();
    SELECT jsonb_object_agg(key, to_jsonb(trim_scale(value::numeric * (old_card.data->>'fx')::numeric)::text))
      INTO converted FROM jsonb_each_text(old_card.data->'market');
    UPDATE price_cards SET active=false WHERE id=old_card.id;
    INSERT INTO price_cards(id,connection_id,name,data,active)
      VALUES(new_id,old_card.connection_id,left(old_card.name,80)||' · 人民币',
        old_card.data || jsonb_build_object('currency','CNY','fx','1','market',converted,
          'note','由历史价卡按原固定汇率换算为人民币基准价；采购与销售系数不变，直接按人民币结算。原始价卡保留供历史核对。'),true);
    INSERT INTO platform_audit(action,target_id,summary)
      VALUES('price.convert_cny',new_id::text,jsonb_build_object('previous_price_id',old_card.id,
        'connection_id',old_card.connection_id,'original_fx',old_card.data->>'fx'));
  END LOOP;
END $$;

INSERT INTO schema_versions(version) VALUES ('007_cny_price_cards');
