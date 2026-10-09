import { describe, expect, it } from 'vitest';
import { buildChart, sampleSeries } from './chart';
import type { SeriesPoint } from '../../domain/performance';

const series = (values: number[], principals?: number[], start = 1): SeriesPoint[] =>
  values.map((value, k) => ({
    date: `2026-01-${String(start + k).padStart(2, '0')}`,
    value,
    principal: principals ? principals[k]! : value,
  }));

describe('sampleSeries', () => {
  it('keeps short series as they are', () => {
    const s = series([1, 2, 3]);
    expect(sampleSeries(s)).toEqual(s);
  });

  it('thins long series to at most about 420 points and always keeps the last day', () => {
    const long = Array.from({ length: 1000 }, (_, k) => ({ date: String(k).padStart(4, '0'), value: k, principal: k }));
    const sampled = sampleSeries(long);
    expect(sampled.length).toBeLessThanOrEqual(421);
    expect(sampled[0]).toBe(long[0]);
    expect(sampled.at(-1)).toBe(long.at(-1));
  });
});

describe('buildChart', () => {
  it('spans the full width, first point at x=0 and last at x=width', () => {
    const chart = buildChart({ points: series([100, 120, 110]), width: 350, long: false, events: [] });
    expect(chart.x(0)).toBe(0);
    expect(chart.x(2)).toBe(350);
    expect(chart.valuePath.startsWith('M0.0,')).toBe(true);
    expect(chart.valuePath).toContain('L350.0,');
    expect(chart.areaPath.endsWith('L350,150 L0,150 Z')).toBe(true);
  });

  it('puts higher values higher up and keeps a margin inside the 150px height', () => {
    const chart = buildChart({ points: series([100, 200]), width: 350, long: false, events: [] });
    expect(chart.y(200)).toBeLessThan(chart.y(100));
    expect(chart.y(200)).toBeGreaterThan(0);
    expect(chart.y(100)).toBeLessThan(150);
  });

  it('does not divide by zero for a flat line', () => {
    const chart = buildChart({ points: series([100, 100, 100]), width: 350, long: false, events: [] });
    expect(Number.isFinite(chart.y(100))).toBe(true);
    expect(chart.valuePath).not.toContain('NaN');
  });

  it('draws the principal as steps (horizontal, then vertical)', () => {
    const chart = buildChart({ points: series([100, 110, 130], [100, 100, 110]), width: 300, long: false, events: [] });
    expect(chart.principalPath).toMatch(/^M0,[\d.]+ H150\.0 V[\d.]+ H300\.0 V[\d.]+$/);
  });

  it('places a flow dot on the first point on or after its date, at the new principal', () => {
    const points = series([100, 110, 130, 131], [100, 100, 110, 110]);
    const chart = buildChart({ points, width: 300, long: false, events: [{ date: '2026-01-03', kind: 'deposit', amount: 10 }] });
    expect(chart.eventMarks).toEqual([{ x: chart.x(2), y: chart.y(110), kind: 'deposit' }]);
  });

  it('chooses the tick count from the width and the label format from the range length', () => {
    expect(buildChart({ points: series([1, 2, 3, 4, 5]), width: 350, long: false, events: [] }).ticks.map((t) => t.label)).toEqual([
      '01-01',
      '01-03',
      '01-05',
    ]);
    const wide = buildChart({ points: series([1, 2, 3, 4, 5]), width: 1360, long: true, events: [] });
    expect(wide.ticks).toHaveLength(12);
    expect(wide.ticks[0]).toMatchObject({ label: '2026-01', align: 'left' });
    expect(wide.ticks.at(-1)!.align).toBe('right');
  });

  it('maps a finger position to the nearest point', () => {
    const chart = buildChart({ points: series([1, 2, 3, 4, 5]), width: 350, long: false, events: [] });
    expect(chart.indexAt(0)).toBe(0);
    expect(chart.indexAt(1)).toBe(4);
    expect(chart.indexAt(0.5)).toBe(2);
    expect(chart.indexAt(1.3)).toBe(4);
  });

  it('handles a single point without NaN', () => {
    const chart = buildChart({ points: series([100]), width: 350, long: false, events: [] });
    expect(chart.x(0)).toBe(350);
    expect(chart.valuePath).not.toContain('NaN');
  });
});
