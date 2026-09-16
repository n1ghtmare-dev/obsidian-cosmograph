export type PerformanceTier = "full" | "balanced" | "massive";

export type PerformanceProfile = {
  tier: PerformanceTier;
  batchedNotes: boolean;
  maxPixelRatio: number;
  maxGraphEdges: number;
  baseLabelBudget: number;
  focusLabelBudget: number;
  pointSizeScale: number;
  targetFps: number;
};

const FULL_PROFILE: PerformanceProfile = {
  tier: "full",
  batchedNotes: false,
  maxPixelRatio: 1.8,
  maxGraphEdges: Number.POSITIVE_INFINITY,
  baseLabelBudget: Number.POSITIVE_INFINITY,
  focusLabelBudget: Number.POSITIVE_INFINITY,
  pointSizeScale: 1,
  targetFps: 60,
};

const BALANCED_PROFILE: PerformanceProfile = {
  tier: "balanced",
  batchedNotes: true,
  maxPixelRatio: 1.45,
  maxGraphEdges: 10_000,
  baseLabelBudget: 220,
  focusLabelBudget: 180,
  pointSizeScale: 0.96,
  targetFps: 50,
};

const MASSIVE_PROFILE: PerformanceProfile = {
  tier: "massive",
  batchedNotes: true,
  maxPixelRatio: 1.15,
  maxGraphEdges: 14_000,
  baseLabelBudget: 120,
  focusLabelBudget: 140,
  pointSizeScale: 0.86,
  targetFps: 36,
};

export function performanceProfileFor(nodeCount: number): PerformanceProfile {
  if (nodeCount <= 800) return FULL_PROFILE;
  if (nodeCount <= 5_000) return BALANCED_PROFILE;
  return MASSIVE_PROFILE;
}

export function sampleEvenly<T>(items: readonly T[], budget: number): T[] {
  if (!Number.isFinite(budget) || items.length <= budget) return [...items];
  const safeBudget = Math.max(0, Math.trunc(budget));
  if (safeBudget === 0) return [];
  const stride = items.length / safeBudget;
  return Array.from({ length: safeBudget }, (_, index) => items[Math.floor(index * stride)]);
}
