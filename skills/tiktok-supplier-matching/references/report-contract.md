# 批量输入、状态与交付

## 文件输入

`prepare_batch.mjs` 接受 `schema_version: 1`、`products` 以及可选 `supplier_results`。模板只含字段，不含实际货源。

- `products` 可直接是 TK URL 字符串数组；也可为对象，包含 `item_id`、`tk_url`、字符串 `tk_product_id`/`tk_sku_id`、`region`、`title`、`images`、`attributes`、`chinese_queries`、`evidence`、`required_comparisons`、`target_spec_confirmed`。
- 未给 `item_id` 时按市场、商品 ID（无 ID 时用 URL）、SKU 生成稳定 ID。补齐 ID 后应沿用已生成的 `item_id`，防止人工记录失去关联。
- 完全重复记录去重；相同身份但信息不同会报错，要求先合并证据，不静默丢弃新信息。短链和长链在身份解析前可能仍是两条任务。
- `supplier_results` 每项包含 `item_id`、`provider`、`fetched_at`、`status`、`candidates`。`ok` 必须有候选；`no_match`/`error` 必须为空，错误另填 `error_code`。没有结果字段表示尚未接入，不是无货源。
- 候选包含 `offer_id`、可空的 `sku_id`、真实 `offer_url`、`title`、`comparisons`，可附报价、包装、图片和供应商证据。`confirmation.status=confirmed` 必须有用户确认记录 `confirmation.source`。

脚本不会检索图片或自动语义比较，也不把 key 存在视为通道可用。

## 任务状态

| 状态 | 含义 |
| --- | --- |
| needs_product_details | 商品 ID、市场或图片待补 |
| awaiting_supplier_access | 已准备搜索素材，待 1688 通道或真实候选导入 |
| supplier_error | 查询出错；保留错误原因 |
| no_match | 在本次明确查询范围内未命中 |
| pending_review | 有待复核候选 |
| all_candidates_rejected | 当前候选均有规格冲突 |
| has_confirmed_candidate | 至少一个候选有人工确认，仍需报价/测样 |

## 交付表

| TK商品/目标规格 | 1688候选与SKU | 关键差异 | 对应数量采购价 | 重量尺寸来源 | 匹配状态 | 待人工处理 |
| --- | --- | --- | --- | --- | --- | --- |

报告先给总商品数、未接入/未命中/待复核/已确认数量，再列推荐买样项。未计算利润的记录不给利润排名。

保留原始取数文件、归一化输入、脚本输出及人工确认记录。利润方案关联 `case_id`，测样表按 SKU 与包装版本记录；不在这里复制一份独立成本公式。
