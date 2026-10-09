import { useT } from '../i18n';
import { TABS } from './tabs';
import type { TabId } from './tabs';

/** badges: something a tab wants to point out (a dot after its name; screen readers read the sentence) */
export function TabBar({
  active,
  onSelect,
  badges = {},
}: {
  active: TabId;
  onSelect: (id: TabId) => void;
  badges?: Partial<Record<TabId, string>>;
}) {
  const t = useT();
  return (
    <nav className="tabbar" aria-label={t.shell.mainNav}>
      {TABS.map((id) => {
        const badge = badges[id];
        return (
          <button
            key={id}
            type="button"
            className="tabbar-item"
            aria-current={id === active ? 'page' : undefined}
            onClick={() => onSelect(id)}
          >
            <span className="tabbar-dot" aria-hidden="true" />
            <span className="tabbar-label">
              {t.shell.tabs[id]}
              {badge && (
                <>
                  <span className="tabbar-badge" aria-hidden="true" />
                  <span className="visually-hidden">
                    {t.shell.badgeSeparator}
                    {badge}
                  </span>
                </>
              )}
            </span>
          </button>
        );
      })}
    </nav>
  );
}
