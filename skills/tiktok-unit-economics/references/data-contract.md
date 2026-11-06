# 方案输入与人工回填

## 方案身份与售价

- `schema_version=1`，`case_id` 唯一标识一个货源/SKU/采购量/包装/物流方案，`as_of` 为 YYYY-MM-DD。
- `market` 为明确目的国，`base_currency` 为销售收入币种，`currency_decimals` 默认为 2，可设 0–4。输入金额为普通币值，不是分。
- `supply` 保存 `item_id`、TK 商品/SKU、1688 offer/SKU（ID 均字符串）、`match_status` 及人工确认来源。未确定货源时可为 candidate/unresolved，测算保留假设。
- `sales.item_revenue` 是一单商品成交收入，扣除卖家承担的优惠，排除代收税；`buyer_shipping_revenue` 单独填写；`units_per_order` 为一单含几个 TK 销售单元。三件套可以是一个销售单元，而不是三单。
- FastMoss 展示价不保证等于真实成交价；价格不确定时分别创建情景，不假装得到真实订单收入。平台补贴、运费补贴等未支持的收入不要偷偷并入商品价，需明确收入和扣费口径后再扩展模型。

## 费用数组 costs

以下每个类目都必须声明一次，不重复；国际运费由 `shipping` 处理，不在其他类目重复计入。

| category | 内容 |
| --- | --- |
| procurement | 对应采购量/SKU/销售单元的采购成本 |
| domestic_shipping | 国内采购运输分摊 |
| packaging | 包材、打包和必要组装费用；已有履约包含时避免重复 |
| fulfillment | 拣货、仓储及其他按单履约分摊 |
| duties_taxes | 卖家承担的税费，避免与运费包税重复 |
| creator_commission | 达人佣金/合作成本分摊 |
| advertising | 单均广告成本或明确的试算假设 |
| returns_losses | 退款、退货、损坏等预计单均损耗 |
| other | 其他可归属成本，注明构成 |

每条填写 `category`、`status`、`amount`、`currency`、`basis` 与 `source`。

- `confirmed` / `estimated`：金额为非负数，`basis` 为 per_order 或 per_sale_unit；注明报价、用户输入或计算依据。
- `unknown`：金额可为 null；计算器返回 incomplete，不把它当零。
- `not_applicable`：金额明确为 0，`source` 写用户确认不适用的原因。
- `excluded`：用户明确要求不计入本方案，`source` 写原因，结果展示排除项；不能因费用未知自动设 excluded。

佣金、广告和损耗在本版以单均金额输入。如果按比例估算，先记录费率、基数与公式，再转换金额；退款率不是退款损失率，不直接乘售价冒充完整损耗。

## 汇率与平台费用

- `fx_rates` 每项含 `currency`、`rate_to_base`、`as_of`、`source`，表示 **1 原币 = rate_to_base 基准币**。同币种不用汇率；跨币种缺失时不能输出完整利润。
- `platform_fee.rate` 默认 0.06，源于当前用户条件，不代表已核验平台现行费率。
- `basis` 可为 item_revenue、total_revenue 或 custom；custom 时填写同币种 `custom_base`。未填 basis 时默认商品成交收入并在输出披露假设。

## 包装与物流

`shipping.mode=rate_card` 时，`parcel` 使用 kg、cm，支持重量精度 0.001 kg、尺寸精度 0.1 cm。字段：weight_kg、length_cm、width_cm、height_cm、units_per_parcel、basis、recorded_at、source。basis 为 supplier、measured 或 assumed。

`units_per_parcel` 必须等于本次 units_per_order。样品表记录原品净重和最终包装毛重；只有后者进入运费。把实测记录关联到具体 SKU、包装版本、日期和记录人。

`rate_card` 至少包含线路名、币种、目的国、有效期、来源、计重方式、计重进位、最低计重、最大实际/计费重量、最大边长、运价及明确附加费。`package_eligibility_confirmed` 必须为 true，表示用户或有依据的核验已确认该货物、目的地区域、周长等其他适用条件；不能为了通过脚本默认勾选。

`shipping.mode=manual` 时，填写 amount、currency、basis=per_order、source、quoted_at 和 valid_until。用于已有准确报价或头程/尾程完成分摊的每单总运费，source 说明包含的费用；不在 rate_card 与其他成本重复记账。

输入模板中的 null 和 false 是待填写项；未补齐的模板不是可用报价。实测、价格和线路更改应复制为新 case/版本后重算，保留旧数据。
