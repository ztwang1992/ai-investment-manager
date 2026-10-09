import type { FlowEvent, SeriesPoint } from '../../domain/performance';

// Coordinates for the returns chart (written as in the prototype): the total-assets line, the stepped principal line, the area, ticks, and the deposit / withdrawal dots.

export const CHART_HEIGHT = 150;
const MAX_POINTS = 420;
const TICK_SPACING = 110;

export interface Tick {
  x: number;
  label: string;
  align: 'left' | 'center' | 'right';
}

export interface EventMark {
  x: number;
  y: number;
  kind: FlowEvent['kind'];
}

export interface Chart {
  width: number;
  height: number;
  points: SeriesPoint[];
  x: (index: number) => number;
  y: (value: number) => number;
  valuePath: string;
  principalPath: string;
  areaPath: string;
  ticks: Tick[];
  eventMarks: EventMark[];
  /** The point at the finger's horizontal position on the chart (0–1) */
  indexAt: (ratio: number) => number;
}

/** With too many points, samples evenly down to about 420, keeping the first and last. */
export function sampleSeries(points: readonly SeriesPoint[], max = MAX_POINTS): SeriesPoint[] {
  if (points.length <= max) return [...points];
  const step = Math.ceil(points.length / max);
  const sampled: SeriesPoint[] = [];
  for (let k = 0; k < points.length - 1; k += step) sampled.push(points[k]!);
  sampled.push(points.at(-1)!);
  return sampled;
}

const tickLabel = (date: string, long: boolean) => (long ? date.slice(0, 7) : date.slice(5));

export function buildChart(i: {
  points: readonly SeriesPoint[];
  width: number;
  height?: number;
  long: boolean;
  events: readonly FlowEvent[];
}): Chart {
  const width = i.width;
  const height = i.height ?? CHART_HEIGHT;
  const points = sampleSeries(i.points);
  const n = points.length;

  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  for (const p of points) {
    min = Math.min(min, p.value, p.principal);
    max = Math.max(max, p.value, p.principal);
  }
  if (n === 0) {
    min = 0;
    max = 1;
  }
  const pad = (max - min) * 0.08 || Math.abs(max) * 0.02 || 1;
  min -= pad;
  max += pad;

  const x = (index: number) => (n > 1 ? (index / (n - 1)) * width : width);
  const y = (value: number) => height - 4 - ((value - min) / (max - min)) * (height - 10);
  const fmt = (v: number) => v.toFixed(1);

  const valuePath = points.map((p, k) => `${k ? 'L' : 'M'}${fmt(x(k))},${fmt(y(p.value))}`).join(' ');
  const principalPath = points
    .map((p, k) => (k ? `H${fmt(x(k))} V${fmt(y(p.principal))}` : `M0,${fmt(y(p.principal))}`))
    .join(' ');
  const areaPath = n > 0 ? `${valuePath} L${width},${height} L0,${height} Z` : '';

  const tickCount = Math.max(3, Math.round(width / TICK_SPACING));
  const ticks: Tick[] =
    n === 0
      ? []
      : Array.from({ length: tickCount }, (_, k) => {
          const index = Math.round((k / (tickCount - 1)) * (n - 1));
          const align = k === 0 ? 'left' : k === tickCount - 1 ? 'right' : 'center';
          return { x: x(index), label: tickLabel(points[index]!.date, i.long), align };
        });

  const eventMarks: EventMark[] = [];
  for (const e of i.events) {
    const index = points.findIndex((p) => p.date >= e.date);
    if (index < 0) continue;
    eventMarks.push({ x: x(index), y: y(points[index]!.principal), kind: e.kind });
  }

  const indexAt = (ratio: number) => Math.max(0, Math.min(n - 1, Math.round(ratio * (n - 1))));

  return { width, height, points, x, y, valuePath, principalPath, areaPath, ticks, eventMarks, indexAt };
}
