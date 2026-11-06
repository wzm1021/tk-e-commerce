// Same rules for browser preflight and server validation; saving a draft stays allowed.
export function requiredTestFields(data) {
  const issues = [];
  const add = (path, message) => issues.push({ path, message });
  if (!data.name?.trim()) add("name", "请填写本次测品的名称");
  if (!data.market) add("market", "请选择销售市场");
  if (!data.currency?.trim()) add("currency", "请填写销售市场对应的币种");
  if (!data.material_language?.trim())
    add("material_language", "请填写截图使用的语言，例如 en-US");
  if (!data.question?.trim())
    add("question", "请填写各方案需要回答的核心测试问题");
  const arms = data.arms.map((arm) => {
    const a = structuredClone(arm),
      control = data.arms[0];
    if (a.id !== "A" && !a.other_product) a.url ||= control.url;
    for (const key of a.inherit) {
      if (key.startsWith("pricing."))
        a.pricing[key.slice(8)] = control.pricing[key.slice(8)];
      else a.product[key] = control.product[key];
    }
    return a;
  });
  arms.forEach((a, i) => {
    const p = `arms.${i}.`;
    const source = data.arms[i];
    if (!a.label?.trim()) add(p + "label", "请填写方案名称");
    if (!a.url?.trim() && (i === 0 || source.other_product || source.url))
      add(p + "url", "请填写该商品的完整 https:// 详情页链接");
    if (!a.product.name?.trim() && !source.inherit.includes("name"))
      add(p + "product.name", "请填写此方案的商品名称");
    if (
      !(Number(a.pricing.current_price) > 0) &&
      !source.inherit.includes("pricing.current_price")
    )
      add(p + "pricing.current_price", "请填写截图中大于 0 的实际售价");
    if (!a.image_id) add(p + "image_id", "请上传此方案的完整商品页面截图");
  });
  const sharedUse =
    arms.length &&
    arms[0].product.use?.trim() &&
    arms.every((a) => a.product.use?.trim() === arms[0].product.use.trim());
  if (!sharedUse && !data.shopper_problem?.trim())
    add(
      "shopper_problem",
      "请填写共同的消费者问题；只有各方案用途相同且均已填写时，此项才可留空",
    );
  return issues;
}
