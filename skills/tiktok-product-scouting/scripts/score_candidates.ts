import { readFile } from "node:fs/promises";

const DEFAULT_WEIGHTS = {
  demand_momentum: 25,
  competition_window: 20,
  content_replicability: 15,
  unit_economics: 15,
  operational_fit: 15,
  evidence_confidence: 10,
} as const;

type Dimension = keyof typeof DEFAULT_WEIGHTS;

interface CandidateInput {
  id: string;
  title: string;
  dimensions: Record<Dimension, number>;
  hard_stops?: string[];
  warnings?: string[];
}

interface ScoreInput {
  candidates: CandidateInput[];
  weights?: Partial<Record<Dimension, number>>;
}

function assertScore(value: number, field: string): void {
  if (!Number.isFinite(value) || value < 0 || value > 100) {
    throw new Error(`${field} 必须是 0–100 的有限数字`);
  }
}

export function scoreCandidates(input: ScoreInput) {
  if (!Array.isArray(input.candidates)) throw new Error("candidates 必须是数组");

  const weights = { ...DEFAULT_WEIGHTS, ...input.weights };
  const weightTotal = Object.values(weights).reduce((sum, value) => sum + value, 0);
  if (!Number.isFinite(weightTotal) || weightTotal <= 0) {
    throw new Error("权重总和必须大于 0");
  }

  return input.candidates
    .map((candidate) => {
      if (!candidate.id || !candidate.title) throw new Error("候选商品缺少 id 或 title");
      for (const dimension of Object.keys(DEFAULT_WEIGHTS) as Dimension[]) {
        assertScore(candidate.dimensions[dimension], `${candidate.id}.${dimension}`);
      }

      const weightedScore = (Object.keys(weights) as Dimension[]).reduce(
        (sum, dimension) =>
          sum + candidate.dimensions[dimension] * weights[dimension],
        0,
      );
      const score = Math.round((weightedScore / weightTotal) * 10) / 10;
      const hardStops = candidate.hard_stops ?? [];
      const confidence = candidate.dimensions.evidence_confidence;

      let recommendation: "shortlist" | "watch/test" | "reject" = "reject";
      if (hardStops.length === 0 && score >= 75 && confidence >= 60) {
        recommendation = "shortlist";
      } else if (hardStops.length === 0 && score >= 60) {
        recommendation = "watch/test";
      }

      return {
        id: candidate.id,
        title: candidate.title,
        score,
        recommendation,
        hard_stops: hardStops,
        warnings: candidate.warnings ?? [],
        dimensions: candidate.dimensions,
      };
    })
    .sort((left, right) => {
      const leftRejected = left.recommendation === "reject" ? 1 : 0;
      const rightRejected = right.recommendation === "reject" ? 1 : 0;
      return leftRejected - rightRejected || right.score - left.score;
    });
}

if (import.meta.main) {
  const inputPath = process.argv[2];
  if (!inputPath) {
    console.error("用法: node score_candidates.ts <candidates.json>");
    process.exitCode = 1;
  } else {
    const input = JSON.parse(await readFile(inputPath, "utf8")) as ScoreInput;
    console.log(JSON.stringify(scoreCandidates(input), null, 2));
  }
}
