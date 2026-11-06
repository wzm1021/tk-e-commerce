# 评论取数与采样

| 需要 | 本地方法 | 注意 |
| --- | --- | --- |
| 解析商品 | `products.search` | 精确匹配卖家/市场，不把同名商品混在一起 |
| 商品背景 | `products.detailInfo` | 核实被评价对象，历史评论可能对应旧版商品 |
| 买家评价 | `products.reviewList` | 支持时间范围和排序，不支持任意星级筛选 |
| 变体背景 | `products.sku` | 只有评论本身提供可匹配 SKU 时才用于变体归因 |

```sh
npm run fastmoss -- products.reviewList '{"filter":{"product_id":"已解析的商品ID","time_range_days":28},"orderby":[{"field":"create_time","order":"desc"}],"page":1,"pagesize":10}'
npm run fastmoss -- products.reviewList '{"filter":{"product_id":"已解析的商品ID","time_range_days":28},"orderby":[{"field":"rating","order":"asc"}],"page":1,"pagesize":10}'
npm run fastmoss -- products.reviewList '{"filter":{"product_id":"已解析的商品ID","time_range_days":28},"orderby":[{"field":"rating","order":"desc"}],"page":1,"pagesize":10}'
```

## 采样记录

- 每页上限 10；要 20 条近期评论则取 `create_time desc` 的第 1、2 页。排序可用字段为 `rating`、`create_time`、`review_id`。
- 当前 `filter` 只有 `product_id` 与 `time_range_days`，不要编造 `rating_range`、语言或 `sku_id` 筛选参数；返回后在本地分类。
- 记录每条评论的来源产品、查询时间窗、排序、页码、采样组、实际星级与日期。低星排序第一页不保证有低星评论，按实际评分描述。
- 近期样本作为主要描述样本；高/低星补充仅用于发现主题与反例。跨组重复按 `product_id + review_id` 去重，并保留所有采样组成员关系。
- 无 review ID 时优先用实际可得的作者标识、日期、SKU 与规范化文本组合识别疑似重复；仍有歧义时标记，不盲目删除不同买家的同文短评。
- 保存原始取回数、唯一评论数、有文本可分析数、各组数、空文本数、疑似重复数和源报告总数。源总数的时间/筛选口径不明时不计算覆盖率。
- 翻页期间新增评论可能造成重叠或遗漏，保留采集时间；无新增唯一记录、返回空页、到达源末尾或预算耗尽时停止。
- `products.sku` 仅支持 7/28 天；SKU 的销售/库存份额不能推导真实库存件数、缺货历史或退货。
