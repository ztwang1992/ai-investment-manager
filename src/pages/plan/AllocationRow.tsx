import { MASK, formatFull } from '../../app/format';
import { slotColor, slotName } from '../../app/palette';
import type { AllocationLine, CashCurrency, Exposure } from '../../domain/types';
import { useT } from '../../i18n';

/** A line in an "Invest new money" or "Withdraw" suggestion: asset, amount, instrument and account, change in share. */
export function AllocationRow({
  line,
  currency,
  exposures,
  sub,
  hide,
  tone,
}: {
  line: AllocationLine;
  currency: CashCurrency;
  exposures: Record<string, Exposure>;
  sub: string;
  hide: boolean;
  tone: 'gain' | 'loss';
}) {
  const t = useT();
  return (
    <div className="alloc-row list-row">
      <span className="dot" style={{ background: slotColor(line.slotKey) }} />
      <span className="alloc-name">{slotName(line.slotKey, exposures, t)}</span>
      <span className="alloc-amount">{hide ? MASK : formatFull(line.amount, currency)}</span>
      <span />
      <span className="alloc-sub">{sub}</span>
      <span className={`alloc-move ${tone === 'gain' ? 'is-gain' : 'is-loss'}`}>
        {line.beforePct.toFixed(1)}% → {line.afterPct.toFixed(1)}%
      </span>
    </div>
  );
}
