export type TikTokDataSource = "clawec" | "fastmoss";

export interface NumericMetricObservation {
  source: TikTokDataSource;
  entityType: "product" | "creator" | "shop" | "video" | "live" | "market";
  entityId: string;
  metric: string;
  value: number;
  unit?: string;
  period?: string;
  asOf?: string;
}

export type ValidationStatus = "matched" | "warning" | "mismatch";

export interface MetricComparison {
  left: NumericMetricObservation;
  right: NumericMetricObservation;
  absoluteDifference: number;
  relativeDifference: number;
  status: ValidationStatus;
  notes: string[];
}

export interface CompareMetricOptions {
  absoluteTolerance?: number;
  relativeWarningTolerance?: number;
  relativeMismatchTolerance?: number;
}

export function compareNumericMetrics(
  left: NumericMetricObservation,
  right: NumericMetricObservation,
  options: CompareMetricOptions = {},
): MetricComparison {
  const notes: string[] = [];
  if (left.entityType !== right.entityType || left.entityId !== right.entityId) {
    throw new Error("交叉验证必须使用相同实体类型和实体 ID");
  }
  if (left.metric !== right.metric) {
    throw new Error("交叉验证必须使用相同指标名");
  }
  if (left.unit !== right.unit) notes.push("两个数据源的指标单位不同");
  if (left.period !== right.period) notes.push("两个数据源的统计周期不同");
  if (left.asOf !== right.asOf) notes.push("两个数据源的数据截止时间不同");

  const absoluteDifference = Math.abs(left.value - right.value);
  const denominator = Math.max(Math.abs(left.value), Math.abs(right.value), 1);
  const relativeDifference = absoluteDifference / denominator;
  const absoluteTolerance = options.absoluteTolerance ?? 0;
  const warningTolerance = options.relativeWarningTolerance ?? 0.05;
  const mismatchTolerance = options.relativeMismatchTolerance ?? 0.2;

  let status: ValidationStatus = "matched";
  if (absoluteDifference > absoluteTolerance && relativeDifference > warningTolerance) {
    status = relativeDifference > mismatchTolerance ? "mismatch" : "warning";
  }
  if (notes.length > 0 && status === "matched") status = "warning";

  return {
    left,
    right,
    absoluteDifference,
    relativeDifference,
    status,
    notes,
  };
}

export interface CrossValidateRequest<TClawec, TFastMoss> {
  clawecRequest: () => Promise<TClawec>;
  fastmossRequest: () => Promise<TFastMoss>;
  extractClawec: (response: TClawec) => NumericMetricObservation;
  extractFastMoss: (response: TFastMoss) => NumericMetricObservation;
  compare?: CompareMetricOptions;
}

export async function crossValidate<TClawec, TFastMoss>(
  request: CrossValidateRequest<TClawec, TFastMoss>,
) {
  const [clawecResponse, fastmossResponse] = await Promise.all([
    request.clawecRequest(),
    request.fastmossRequest(),
  ]);
  const comparison = compareNumericMetrics(
    request.extractClawec(clawecResponse),
    request.extractFastMoss(fastmossResponse),
    request.compare,
  );

  return { clawecResponse, fastmossResponse, comparison };
}
