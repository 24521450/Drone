export type FieldPlotStatus =
  | "NORMAL"
  | "WATER_STRESS"
  | "POSSIBLE_DISEASE"
  | "NUTRIENT_STRESS";

export type FieldCoordinate = { latitude: number; longitude: number };
export type FieldBoundaryInput = {
  type: "POLYGON" | "CIRCLE";
  polygon?: FieldCoordinate[];
  center?: FieldCoordinate;
  radiusMeters?: number;
};

export type FieldPlotInput = {
  id: string;
  name: string;
  areaHectares: number;
  virtual?: boolean;
  latestScanAt?: Date | string;
};

export type FieldPlot = {
  id: string;
  name: string;
  areaHectares: number;
  virtual: boolean;
  status: FieldPlotStatus;
  healthScore: number;
  diseaseRiskPercent: number;
  waterStressPercent: number;
  nutrientStressPercent: number;
  latestScanAt: string;
};

export type FieldIntelligence = {
  generatedAt: string;
  source: "SIMULATED_ANALYSIS";
  sourceLabel: string;
  field: { name: string; areaHectares: number; plotsCount: number };
  summary: {
    averageHealthScore: number;
    normal: number;
    waterStress: number;
    possibleDisease: number;
    nutrientStress: number;
    lastScanAt: string | null;
  };
  plots: FieldPlot[];
};

const clamp = (value: number, minimum: number, maximum: number) =>
  Math.min(maximum, Math.max(minimum, value));
const round = (value: number, digits = 0) => {
  const scale = 10 ** digits;
  return Math.round(value * scale) / scale;
};
const hash = (value: string) => {
  let result = 2166136261;
  for (const character of value)
    result = Math.imul(result ^ character.charCodeAt(0), 16777619);
  return result >>> 0;
};

export function estimateBoundaryAreaHectares(boundary: FieldBoundaryInput) {
  if (
    boundary.type === "CIRCLE" &&
    Number.isFinite(boundary.radiusMeters) &&
    (boundary.radiusMeters ?? 0) > 0
  )
    return round((Math.PI * (boundary.radiusMeters ?? 0) ** 2) / 10_000, 2);
  const points = boundary.polygon ?? [];
  if (points.length < 3) return 0;
  const latitude = points.reduce((total, point) => total + point.latitude, 0) / points.length;
  const latitudeScale = 111_320;
  const longitudeScale = latitudeScale * Math.max(Math.cos((latitude * Math.PI) / 180), 0.1);
  const area = points.reduce((total, point, index) => {
    const next = points[(index + 1) % points.length];
    const x1 = point.longitude * longitudeScale;
    const y1 = point.latitude * latitudeScale;
    const x2 = next.longitude * longitudeScale;
    const y2 = next.latitude * latitudeScale;
    return total + x1 * y2 - x2 * y1;
  }, 0);
  return round(Math.abs(area) / 2 / 10_000, 2);
}

function analyzePlot(input: FieldPlotInput, now: Date): FieldPlot {
  const seed = hash(input.id);
  const diseaseRiskPercent = 8 + (seed % 68);
  const waterStressPercent = 10 + ((seed >>> 8) % 66);
  const nutrientStressPercent = 6 + ((seed >>> 16) % 45);
  const healthScore = clamp(
    Math.round(
      100 -
        diseaseRiskPercent * 0.3 -
        waterStressPercent * 0.28 -
        nutrientStressPercent * 0.16,
    ),
    0,
    100,
  );
  const status: FieldPlotStatus =
    diseaseRiskPercent >= 62
      ? "POSSIBLE_DISEASE"
      : waterStressPercent >= 56
        ? "WATER_STRESS"
        : nutrientStressPercent >= 38
          ? "NUTRIENT_STRESS"
          : "NORMAL";
  const scanAt = input.latestScanAt
    ? new Date(input.latestScanAt)
    : new Date(now.getTime() - (seed % 72) * 3_600_000);
  return {
    id: input.id,
    name: input.name,
    areaHectares: round(Math.max(0, Number(input.areaHectares) || 0), 2),
    virtual: input.virtual === true,
    status,
    healthScore,
    diseaseRiskPercent,
    waterStressPercent,
    nutrientStressPercent,
    latestScanAt: Number.isNaN(scanAt.getTime()) ? now.toISOString() : scanAt.toISOString(),
  };
}

export function buildFieldIntelligence(input: {
  now?: Date;
  plots?: FieldPlotInput[];
} = {}): FieldIntelligence {
  const now = input.now ?? new Date();
  const plots = (input.plots ?? []).map((plot) => analyzePlot(plot, now));
  const statusCounts = {
    normal: plots.filter((plot) => plot.status === "NORMAL").length,
    waterStress: plots.filter((plot) => plot.status === "WATER_STRESS").length,
    possibleDisease: plots.filter((plot) => plot.status === "POSSIBLE_DISEASE").length,
    nutrientStress: plots.filter((plot) => plot.status === "NUTRIENT_STRESS").length,
  };
  const latestScanAt = plots
    .map((plot) => plot.latestScanAt)
    .sort()
    .at(-1) ?? null;
  return {
    generatedAt: now.toISOString(),
    source: "SIMULATED_ANALYSIS",
    sourceLabel: "Demo field analysis",
    field: {
      name: "Demo Field #01",
      areaHectares: round(plots.reduce((total, plot) => total + plot.areaHectares, 0), 2),
      plotsCount: plots.length,
    },
    summary: {
      averageHealthScore: plots.length
        ? Math.round(plots.reduce((total, plot) => total + plot.healthScore, 0) / plots.length)
        : 0,
      ...statusCounts,
      lastScanAt: latestScanAt,
    },
    plots,
  };
}
