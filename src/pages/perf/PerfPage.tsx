import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { RefObject } from 'react';
import { MASK, formatAmount, formatMoney, formatSignedPct, sign } from '../../app/format';
import { EyeIcon, EyeOffIcon } from '../../app/icons';
import { getQuotesApi } from '../../app/quotesApi';
import { SLOT_ORDER, slotColor, slotName } from '../../app/palette';
import { useAppStore } from '../../app/store';
import { useT } from '../../i18n';
import { usePullToRefresh } from '../../app/usePullToRefresh';
import { RANGE_KEYS, cumulativeGain } from '../../domain/performance';
import type { RangeKey } from '../../domain/performance';
import { CHART_HEIGHT, buildChart } from './chart';
import { quoteStatusText } from './quoteStatus';
import { usePerfData } from './usePerfData';
import './perf.css';

/** For periods up to 1 year the chart is as wide as its container; longer ones use a fixed width and scroll sideways (README). */
const WIDE_RANGES: Partial<Record<RangeKey, number>> = { '3y': 760, '5y': 1120, all: 1360 };
/** For periods over 120 days, ticks show year and month */
const LONG_RANGES = new Set<RangeKey>(['1y', '3y', '5y', 'all']);
const PULL_TRIGGER = 60;
const TICK_WIDTH = 44;
const CURRENCY_OPTIONS: ('CNY' | 'USD')[] = ['CNY', 'USD'];

function useElementWidth(ref: RefObject<HTMLElement | null>, fallback: number): number {
  const [width, setWidth] = useState(fallback);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = () => setWidth(el.clientWidth || fallback);
    update();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => observer.disconnect();
  }, [ref, fallback]);
  return width;
}

const pctText = (pct: number | null, digits = 2) => (pct === null ? '—' : formatSignedPct(pct, digits));
const tone = (value: number) => (value >= 0 ? 'is-gain' : 'is-loss');

export function PerfPage() {
  const [range, setRange] = useState<RangeKey>('1y');
  const [hover, setHover] = useState<number | null>(null);
  const hide = useAppStore((s) => s.hideAmounts);
  const toggleHide = useAppStore((s) => s.toggleHideAmounts);
  const displayCurrency = useAppStore((s) => s.displayCurrency);
  const setDisplayCurrency = useAppStore((s) => s.setDisplayCurrency);
  const fx = useAppStore((s) => s.fx);
  const t = useT();
  const refreshing = useAppStore((s) => s.refreshing);
  const updatedAt = useAppStore((s) => s.quotesUpdatedAt);
  const quotesError = useAppStore((s) => s.quotesError);
  const refreshQuotes = useAppStore((s) => s.refreshQuotes);
  const data = usePerfData(range);

  const rootRef = useRef<HTMLElement>(null);
  const pull = usePullToRefresh(rootRef, () => void refreshQuotes());

  const scrollRef = useRef<HTMLDivElement>(null);
  const containerWidth = useElementWidth(scrollRef, 350);
  const width = WIDE_RANGES[range] ?? containerWidth;
  const long = LONG_RANGES.has(range);
  const chart = useMemo(
    () => buildChart({ points: data.points, width, long, events: data.summary.flows }),
    [data.points, width, long, data.summary.flows],
  );
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollLeft = el.scrollWidth;
  }, [range, width, data.isFresh]);

  // The curve is already in the display currency (the USD view); the CNY / HKD views convert from CNY at the current rate
  const fmt = (v: number) =>
    data.chartCurrency === 'USD' ? formatAmount(v, 'USD', t.locale, hide) : formatMoney(v, displayCurrency, fx, t.locale, hide);
  const fmtSigned = (v: number) => (hide ? MASK : `${sign(v)}${fmt(Math.abs(v))}`);
  const fmtCnySigned = (v: number) => (hide ? MASK : `${sign(v)}${formatMoney(Math.abs(v), displayCurrency, fx, t.locale)}`);

  const summary = data.summary;
  const last = chart.points.length - 1;
  const index = hover === null ? last : Math.min(last, hover);
  const point = chart.points[index];
  const { gain: cumulative, pct: cumulativePct } = point ? cumulativeGain(point) : { gain: 0, pct: null };
  const maxAbsPct = Math.max(0.01, ...data.slots.map((s) => Math.abs(s.pct ?? 0)));
  const customKeys = data.slots.map((s) => s.slotKey).filter((k) => !SLOT_ORDER.includes(k));

  // The quotes API is fixed at start-up (boot) and doesn't change afterwards
  const status = quoteStatusText({ connected: getQuotesApi() !== null, refreshing, error: quotesError, updatedAt, usdCny: fx.USD, now: new Date() }, t);

  return (
    <section className="perf" ref={rootRef}>
      <div className={`perf-pull${pull ? '' : ' is-released'}`} style={{ height: pull, paddingBottom: pull ? 6 : 0 }}>
        {pull > PULL_TRIGGER ? t.perf.releaseToRefresh : t.perf.pullToRefresh}
      </div>
      <div className="page">
        <div className="perf-header">
          <h1 className="page-title">{t.perf.title}</h1>
          <button type="button" className="btn btn-secondary btn-icon" aria-label={t.perf.showHideAmounts} onClick={toggleHide}>
            {hide ? <EyeOffIcon /> : <EyeIcon />}
          </button>
        </div>

        <div className="perf-controls">
          <select
            className="input"
            aria-label={t.perf.period}
            value={range}
            onChange={(e) => {
              setRange(e.target.value as RangeKey);
              setHover(null);
            }}
          >
            {RANGE_KEYS.map((r) => (
              <option key={r} value={r}>
                {t.perf.ranges[r]}
              </option>
            ))}
          </select>
          <div className="seg" role="radiogroup" aria-label={t.perf.displayCurrency}>
            {CURRENCY_OPTIONS.map((currency) => (
              <label key={currency} className="seg-opt">
                <input
                  type="radio"
                  name="perf-currency"
                  checked={displayCurrency === currency}
                  onChange={() => setDisplayCurrency(currency)}
                />
                {t.perf.currencies[currency]}
              </label>
            ))}
          </div>
        </div>

        <div className="perf-status">
          {refreshing && <span className="perf-spinner" aria-hidden="true" />}
          <span>{status}</span>
        </div>

        {data.isFresh || !point ? (
          <div className="perf-fresh">
            <span className="perf-fresh-label">{t.perf.totalNow}</span>
            <span className="perf-fresh-total">{formatMoney(data.totalCny, displayCurrency, fx, t.locale, hide)}</span>
            <span className="perf-fresh-note">{t.perf.freshNote}</span>
          </div>
        ) : (
          <>
            <div className="perf-readout">
              <span className="perf-readout-label">
                {hover === null ? t.perf.totalNow : t.perf.totalOn(point.date, long)}
              </span>
              <span className="perf-readout-big" data-testid="perf-big">
                {fmt(point.value)}
              </span>
              <span className={`perf-readout-gain ${tone(hover === null ? summary.gain : cumulative)}`} data-testid="perf-gain">
                {hover === null
                  ? `${t.perf.rangeGain[range]} ${hide ? '' : `${fmtSigned(summary.gain)} · `}${pctText(summary.pct)}`
                  : `${t.perf.cumulativeGain} ${hide ? '' : `${fmtSigned(cumulative)} · `}${pctText(cumulativePct)}`}
              </span>
              <span className="perf-readout-sub" data-testid="perf-sub">
                {t.perf.netInvested(fmt(point.principal))}
              </span>
            </div>

            <div className="perf-chart">
              <div className="perf-chart-scroll" ref={scrollRef} data-chart="1">
                <div
                  className="perf-chart-inner"
                  // When the chart is wider than the screen, sideways swipes scroll it; otherwise vertical swipes scroll the page and sideways ones read values
                  style={{ width: chart.width, touchAction: chart.width > containerWidth ? 'pan-x' : 'pan-y' }}
                  onPointerMove={(e) => {
                    const rect = e.currentTarget.getBoundingClientRect();
                    const next = chart.indexAt((e.clientX - rect.left) / rect.width);
                    if (next !== hover) setHover(next);
                  }}
                  onPointerLeave={() => setHover(null)}
                >
                  <svg width={chart.width} height={170} viewBox={`0 0 ${chart.width} 170`}>
                    <path d={chart.areaPath} fill="var(--color-accent-100)" />
                    <path
                      d={chart.principalPath}
                      fill="none"
                      stroke="var(--color-neutral-500)"
                      strokeWidth={2}
                      strokeDasharray="4 4"
                      strokeLinejoin="round"
                    />
                    <path
                      d={chart.valuePath}
                      fill="none"
                      stroke="var(--color-accent)"
                      strokeWidth={2.5}
                      strokeLinejoin="round"
                      strokeLinecap="round"
                    />
                    {chart.eventMarks.map((m, k) => (
                      <circle
                        key={k}
                        cx={m.x}
                        cy={m.y}
                        r={5}
                        fill={m.kind === 'deposit' ? 'var(--color-accent-2)' : 'var(--color-accent)'}
                        stroke="var(--color-bg)"
                        strokeWidth={2}
                      />
                    ))}
                    <line x1={chart.x(index)} x2={chart.x(index)} y1={0} y2={CHART_HEIGHT} stroke="var(--color-neutral-400)" strokeWidth={1.5} />
                    <circle cx={chart.x(index)} cy={chart.y(point.value)} r={5.5} fill="var(--color-accent)" stroke="var(--color-bg)" strokeWidth={2.5} />
                  </svg>
                  {chart.ticks.map((tick, k) => (
                    <span
                      key={k}
                      className="perf-tick"
                      style={{ left: Math.min(chart.width - TICK_WIDTH, Math.max(0, tick.x - TICK_WIDTH / 2)), textAlign: tick.align }}
                    >
                      {tick.label}
                    </span>
                  ))}
                </div>
              </div>
              <div className="perf-legend">
                <span>
                  <span className="perf-swatch-line" />
                  {t.perf.legendTotal}
                </span>
                <span>
                  <span className="perf-swatch-dash" />
                  {t.perf.legendPrincipal}
                </span>
                <span>
                  <span className="dot-sm" style={{ background: 'var(--color-accent-2)' }} />
                  {t.common.txTypes.deposit}
                </span>
                <span>
                  <span className="dot-sm" style={{ background: 'var(--color-accent)' }} />
                  {t.common.txTypes.withdraw}
                </span>
                {chart.width > containerWidth && <span>{t.perf.swipeForEarlier}</span>}
              </div>
            </div>

            <div className="perf-cards">
              <div className="perf-card">
                <span className="perf-card-label">{t.perf.periodReturn}</span>
                <span className={`perf-card-value ${tone(summary.pct ?? 0)}`} data-testid="perf-range-pct">
                  {pctText(summary.pct)}
                </span>
              </div>
              <div className="perf-card">
                <span className="perf-card-label">{t.perf.periodNetInflow}</span>
                <span className="perf-card-value" data-testid="perf-range-in">
                  {hide ? MASK : summary.netInflow === 0 ? fmt(0) : fmtSigned(summary.netInflow)}
                </span>
              </div>
            </div>

            {summary.flows.length > 0 && (
              <div className="perf-section">
                <span className="perf-section-title">{t.perf.flowsTitle}</span>
                <div className="perf-flows">
                  {[...summary.flows].reverse().map((f, k) => (
                    <div key={k} className="perf-flow">
                      <span className="perf-flow-left">
                        <span
                          className="dot-sm"
                          style={{ background: f.kind === 'deposit' ? 'var(--color-accent-2)' : 'var(--color-accent)' }}
                        />
                        {f.date} · {f.kind === 'deposit' ? t.common.txTypes.deposit : t.common.txTypes.withdraw}
                      </span>
                      <span className="perf-flow-amount">{fmtSigned(f.amount)}</span>
                    </div>
                  ))}
                </div>
                <span className="perf-note">{t.perf.principalNote}</span>
              </div>
            )}

            <div className="perf-assets">
              <span className="perf-assets-title">{t.perf.byAsset(t.perf.ranges[range])}</span>
              {data.slots.map((s) => {
                const pct = s.pct ?? 0;
                const color = slotColor(s.slotKey, customKeys.indexOf(s.slotKey));
                return (
                  <div key={s.slotKey} className="perf-asset">
                    <div className="perf-asset-row">
                      <span className="perf-asset-name">
                        <span className="dot" style={{ background: color }} />
                        {slotName(s.slotKey, data.exposureById, t)}
                      </span>
                      <span className={`perf-asset-label ${tone(pct)}`}>
                        {hide ? '' : `${fmtCnySigned(s.gain)} · `}
                        {pctText(s.pct, 1)}
                      </span>
                    </div>
                    <div className="perf-bar">
                      <div
                        className="perf-bar-fill"
                        style={{
                          width: `${(Math.abs(pct) / maxAbsPct) * 100}%`,
                          background: pct >= 0 ? 'var(--color-accent-2)' : 'var(--color-accent)',
                        }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </>
        )}
      </div>
    </section>
  );
}
