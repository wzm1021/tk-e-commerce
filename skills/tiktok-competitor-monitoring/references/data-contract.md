# 数据合同 v1

输入依据 `schemas/fastmoss-tools.snapshot.json` 与 `src/fastmoss/generated-inputs.ts`（2026-08-28）；输出映射依据已归档 FastMoss 实际业务响应（2026-09-14），供应商目前没有稳定 outputSchema。结构不匹配必须降级，不尝试猜测别名。

| 工具 | 固定参数 | 已核验响应路径（decoded[].data 内） |
| --- | --- | --- |
| shop_base_info | filter.seller_id | shop.seller_id / region / currency_code / shop_name / snapshot_at |
| shop_data_trends | filter.seller_id, time_range_days=28 | shop；daily_trend[].date / daily_gmv / daily_units_sold |
| shop_product_analysis | filter.seller_id, time_range_days=7；orderby day7_gmv desc；page=1,pagesize=10 | shop；products.list[].product.product_id / title；performance_summary.selected_window_days / selected_window_gmv / selected_window_units_sold；products.total |

每份证据保留 source、tool、request、invocation_id、captured_at、decoded；JSON 大整数解析为字符串。只有 FastMoss、参数与计划一致、身份匹配、采集时间有效的证据可以进入规则。基础身份是前置条件；趋势与榜单可分别成功。重复日期、负数、非有限数、缺失字段不能构成趋势窗口。旧于运行时间 48 小时的采集快照不作本轮事件依据。

源 snapshot_at 可能没有时区，按原文保存。日趋势选取不晚于运行 UTC 日期减 2 日的最近截止日；最多容忍截止日再滞后 3 日，超过则标记数据过旧并停止趋势提醒。此策略保守等待日期结束，不声称核验了供应商的时区或最终结算数。

基础信息与趋势的货币必须相同。商品榜没有稳定 currency_code，商品数值只保留为来源报告值，不用于金额差分。列表只覆盖前 10；空列表和字段异常均不能推断全店无商品。每个派生事件带来源调用 ID 与实际字段路径，趋势事件同时保留完整比较窗口和公式。
