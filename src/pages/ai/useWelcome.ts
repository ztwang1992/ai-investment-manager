import { formatMoney } from '../../app/format';
import { slotName } from '../../app/palette';
import { useAppStore } from '../../app/store';
import { useT } from '../../i18n';
import { usePlanData } from '../plan/usePlanData';
import { useAiStore } from './aiStore';
import { welcomeText } from './aiText';

/** The first line of a new conversation: total assets, how many are off target and the biggest, from current data (the prototype's welcome()). */
export function useWelcome(): string {
  const data = usePlanData();
  const fx = useAppStore((s) => s.fx);
  const t = useT();
  const displayCurrency = useAppStore((s) => s.displayCurrency);
  const hide = useAppStore((s) => s.hideAmounts);
  const model = useAiStore((s) => s.model);
  return welcomeText(
    {
      model,
      total: formatMoney(data.portfolio.totalCny, displayCurrency, fx, t.locale, hide),
      offCount: data.offCount,
      biggest: data.biggest ? slotName(data.biggest.key, data.portfolio.exposureById, t) : null,
    },
    t,
  );
}
