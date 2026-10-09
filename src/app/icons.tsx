// Lucide icons (stroke width 2.75, as in the prototype). Only the few in use, so the whole icon library isn't pulled in.

const common = {
  width: 18,
  height: 18,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 2.75,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  'aria-hidden': true,
};

export function EyeIcon() {
  return (
    <svg {...common}>
      <path d="M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

export function ChevronLeftIcon() {
  return (
    <svg {...common}>
      <path d="m15 18-6-6 6-6" />
    </svg>
  );
}

export function XIcon() {
  return (
    <svg {...common} width={16} height={16}>
      <path d="M18 6 6 18" />
      <path d="m6 6 12 12" />
    </svg>
  );
}

export function EyeOffIcon() {
  return (
    <svg {...common}>
      <path d="M10.733 5.076a10.744 10.744 0 0 1 11.205 6.575 1 1 0 0 1 0 .696 10.747 10.747 0 0 1-1.444 2.49" />
      <path d="M14.084 14.158a3 3 0 0 1-4.242-4.242" />
      <path d="M17.479 17.499a10.75 10.75 0 0 1-15.417-5.151 1 1 0 0 1 0-.696 10.75 10.75 0 0 1 4.446-5.143" />
      <path d="m2 2 20 20" />
    </svg>
  );
}

export function PanelLeftIcon() {
  return (
    <svg {...common}>
      <rect width="18" height="18" x="3" y="3" rx="2" />
      <path d="M9 3v18" />
    </svg>
  );
}

export function SendIcon() {
  return (
    <svg {...common}>
      <path d="m22 2-7 20-4-9-9-4Z" />
      <path d="M22 2 11 13" />
    </svg>
  );
}

/** For the pending-sync note, next to 13px text, so one size smaller */
export function CloudUploadIcon() {
  return (
    <svg {...common} width={15} height={15} strokeWidth={2.5}>
      <path d="M12 13v8" />
      <path d="M4 14.899A7 7 0 1 1 15.71 8h1.79a4.5 4.5 0 0 1 2.5 8.242" />
      <path d="m8 17 4-4 4 4" />
    </svg>
  );
}
