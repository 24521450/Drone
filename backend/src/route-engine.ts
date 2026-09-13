import { ROUTE_PATTERNS, type RoutePattern } from "./types.js";

export type Coordinate = { latitude: number; longitude: number };
type Point = [number, number];

const hash = (value: string) => {
  let result = 2166136261;
  for (const character of value) result = Math.imul(result ^ character.charCodeAt(0), 16777619);
  return result >>> 0;
};

const randomGenerator = (seed: string) => {
  let state = hash(seed) || 1;
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return (state >>> 0) / 4294967296;
  };
};

const samplePolyline = (vertices: Point[], samplesPerEdge = 8): Point[] => {
  const result: Point[] = [];
  for (let edge = 0; edge < vertices.length - 1; edge += 1) {
    const [x1, y1] = vertices[edge];
    const [x2, y2] = vertices[edge + 1];
    for (let step = 0; step < samplesPerEdge; step += 1) {
      const progress = step / samplesPerEdge;
      result.push([x1 + (x2 - x1) * progress, y1 + (y2 - y1) * progress]);
    }
  }
  result.push(vertices.at(-1)!);
  return result;
};

const polygon = (sides: number, radius: number, rotation = -Math.PI / 2): Point[] => {
  const points = Array.from({ length: sides }, (_, index) => {
    const angle = rotation + index * Math.PI * 2 / sides;
    return [Math.cos(angle) * radius, Math.sin(angle) * radius] as Point;
  });
  return [...points, points[0]];
};

const star = (): Point[] => {
  const points = Array.from({ length: 10 }, (_, index) => {
    const angle = -Math.PI / 2 + index * Math.PI / 5;
    const radius = index % 2 === 0 ? 0.00085 : 0.00036;
    return [Math.cos(angle) * radius, Math.sin(angle) * radius] as Point;
  });
  return [...points, points[0]];
};

const grid = (): Point[] => {
  const points: Point[] = [[-0.0008, -0.00065]];
  for (let column = 0; column < 6; column += 1) {
    const x = -0.0008 + column * 0.00032;
    points.push([x, column % 2 === 0 ? 0.00065 : -0.00065]);
  }
  points.push(points[0]);
  return points;
};

const spiral = (): Point[] => {
  const points: Point[] = [[0, 0]];
  const turns = 2.5;
  const samples = 48;
  for (let index = 1; index <= samples; index += 1) {
    const progress = index / samples;
    const angle = -Math.PI / 2 + progress * Math.PI * 2 * turns;
    const radius = progress * 0.00086;
    points.push([Math.cos(angle) * radius, Math.sin(angle) * radius]);
  }
  points.push([0, 0]);
  return points;
};

const figureEight = (): Point[] => {
  const points: Point[] = [];
  const samples = 64;
  for (let index = 0; index < samples; index += 1) {
    const angle = -Math.PI / 2 + index * Math.PI * 2 / samples;
    points.push([
      Math.sin(angle) * 0.00082,
      Math.sin(angle) * Math.cos(angle) * 0.00058,
    ]);
  }
  points.push(points[0]);
  return points;
};

const zigzag = (): Point[] => [
  [-0.00082, -0.00065],
  [-0.00082, 0.00065],
  [-0.00027, 0.00065],
  [-0.00027, -0.00065],
  [0.00028, -0.00065],
  [0.00028, 0.00065],
  [0.00082, 0.00065],
  [0.00082, -0.00065],
  [-0.00082, -0.00065],
];

const randomWalk = (seed: string): Point[] => {
  const random = randomGenerator(seed);
  const points: Point[] = [[0, 0]];
  let x = 0;
  let y = 0;
  for (let index = 0; index < 22; index += 1) {
    x = Math.max(-0.00085, Math.min(0.00085, x + (random() - 0.5) * 0.00055));
    y = Math.max(-0.0007, Math.min(0.0007, y + (random() - 0.5) * 0.00045));
    points.push([x, y]);
  }
  points.push([0, 0]);
  return points;
};

export function demoCenter(droneCode: string): Coordinate {
  const number = Math.max(1, Number(droneCode.match(/(\d+)$/)?.[1] ?? 1)) - 1;
  const column = number % 5;
  const row = Math.floor(number / 5) % 2;
  return { latitude: 10.7607 + row * 0.0042, longitude: 106.652 + column * 0.0042 };
}

export function createRoute(pattern: RoutePattern, center: Coordinate, seed: string): Coordinate[] {
  let normalized: Point[];
  if (pattern === "STAR") normalized = samplePolyline(star(), 5);
  else if (pattern === "SQUARE") normalized = samplePolyline(polygon(4, 0.00078, Math.PI / 4), 10);
  else if (pattern === "CIRCLE") normalized = polygon(48, 0.00078);
  else if (pattern === "GRID") normalized = samplePolyline(grid(), 6);
  else if (pattern === "TRIANGLE") normalized = samplePolyline(polygon(3, 0.00082), 10);
  else if (pattern === "SPIRAL") normalized = spiral();
  else if (pattern === "FIGURE_EIGHT") normalized = figureEight();
  else if (pattern === "ZIGZAG") normalized = samplePolyline(zigzag(), 6);
  else normalized = samplePolyline(randomWalk(seed), 3);
  return normalized.map(([x, y]) => ({ latitude: center.latitude + y, longitude: center.longitude + x }));
}

export { ROUTE_PATTERNS };
