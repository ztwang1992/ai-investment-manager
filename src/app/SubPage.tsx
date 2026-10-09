import type { ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { ChevronLeftIcon } from './icons';
import { overlayRoot } from './Sheet';

/**
 * Sub-page (Portfolio settings, account Settings): covers the whole phone frame, tab bar included.
 * In the prototype, Portfolio settings spaces its content 22px apart; account Settings 18px, with "+ Add account" to the right of the title.
 */
export function SubPage({
  title,
  backLabel,
  onBack,
  action,
  gap = 22,
  children,
}: {
  title: string;
  backLabel: string;
  onBack: () => void;
  action?: ReactNode;
  gap?: number;
  children: ReactNode;
}) {
  const heading = <h1 className="page-title">{title}</h1>;
  return createPortal(
    <div className="subpage">
      <div className="subpage-body" style={{ gap }}>
        <button type="button" className="btn btn-ghost subpage-back" onClick={onBack}>
          <ChevronLeftIcon />
          {backLabel}
        </button>
        {action ? (
          <div className="subpage-title-row">
            {heading}
            {action}
          </div>
        ) : (
          heading
        )}
        {children}
      </div>
    </div>,
    overlayRoot(),
  );
}
