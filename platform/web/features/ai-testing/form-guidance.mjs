export const productGuidance = {
  name: {
    required: true,
    placeholder: "例如：厨房水槽收纳架",
    hint: "填写商品页上的名称，便于识别本次测试的商品。",
  },
  variant: {
    placeholder: "例如：黑色 / 左侧款 / 1 件装",
    hint: "填写本次测试的颜色、型号或套装规格，与截图保持一致。",
  },
  use: {
    placeholder: "例如：收纳并沥干海绵和刷子",
    hint: "请填写用途，或填写“消费者要解决的问题”；各方案用途不同时，必须填写共同的消费者问题。",
  },
  material: {
    placeholder: "例如：304 不锈钢",
    hint: "以商品页或已核实资料为准，不确定可留空。",
  },
  dimensions: {
    placeholder: "例如：25 × 12 × 8 cm",
    hint: "按长 × 宽 × 高填写，并注明 cm、mm 或英寸等单位。",
  },
  inner_dimensions: {
    placeholder: "例如：20 × 10 × 6 cm",
    hint: "填写内部可用空间的长、宽、深；不适用或未知可留空。",
  },
  key_features: {
    placeholder: "例如：\n可拆卸沥水盘\n免打孔安装",
    hint: "每行一个已确认的卖点，最多 10 项；未知可留空。",
  },
  limitations: {
    placeholder: "例如：\n仅适配直径 18–28 mm 的圆形水龙头\n不适用于方形水龙头",
    hint: "每行一项，最多 10 项；可填写适配限制、安装要求或使用注意事项。",
  },
  "pricing.current_price": {
    required: true,
    placeholder: "例如：19.99",
    hint: "填写截图中该规格的实际售价，只填大于 0 的数字。",
  },
  "pricing.shipping": {
    placeholder: "例如：包邮 / 满 35 免运费",
    hint: "填写运费金额或免邮条件；金额使用当前币种，未知可留空。",
  },
  "pricing.delivery": {
    placeholder: "例如：3–5 个工作日送达",
    hint: "填写商品页承诺的送达时间或范围；未知可留空。",
  },
};
