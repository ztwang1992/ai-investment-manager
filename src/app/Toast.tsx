import { useAppStore } from './store';

/** The message bar at the bottom (the prototype's toast), shown above the tab bar. */
export function Toast() {
  const toast = useAppStore((s) => s.toast);
  if (!toast) return null;
  return (
    <div className="toast" role="status">
      {toast}
    </div>
  );
}
