import { useEffect } from 'react';
import type { ReactNode } from 'react';
import { createPortal } from 'react-dom';

/** The overlay container inside the phone frame; falls back to body outside the shell (e.g. a page tested on its own). */
export function overlayRoot(): HTMLElement {
  return document.getElementById('app-overlay') ?? document.body;
}

/**
 * Bottom sheet: 28px top corners; a tap on the backdrop or Esc closes it (as in the prototype).
 * The prototype's sheets differ slightly: at most 90% or 88% high (or no limit); content spacing 14px or 16px;
 * most keep the title and subtitle together (4px apart); "Rebalancing steps" puts its subtitle on a line of its own (spaced like the content).
 * The subtitle of "To check this period" runs to two lines with the prototype's 1.5 line height, passed in as subtitleClassName.
 */
export function Sheet({
  title,
  subtitle,
  subtitleApart = false,
  subtitleClassName,
  maxHeight = '90%',
  gap = 14,
  onClose,
  children,
}: {
  title: string;
  subtitle?: ReactNode;
  subtitleApart?: boolean;
  subtitleClassName?: string;
  maxHeight?: string;
  gap?: number;
  onClose: () => void;
  children: ReactNode;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const titleEl = <h2 className="sheet-title">{title}</h2>;
  const subtitleEl = subtitle ? (
    <p className={subtitleClassName ? `sheet-subtitle ${subtitleClassName}` : 'sheet-subtitle'}>{subtitle}</p>
  ) : null;
  return createPortal(
    <div className="sheet-backdrop" onClick={onClose}>
      <div
        className="sheet"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        style={{ maxHeight, gap }}
        onClick={(e) => e.stopPropagation()}
      >
        {subtitleApart ? (
          <>
            {titleEl}
            {subtitleEl}
          </>
        ) : (
          <div className="sheet-head">
            {titleEl}
            {subtitleEl}
          </div>
        )}
        {children}
      </div>
    </div>,
    overlayRoot(),
  );
}
