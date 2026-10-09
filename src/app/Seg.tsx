import { useId } from 'react';

/** Segmented control (the design system's .seg), built from hidden radio buttons so screen readers can use it. */
export function Seg<T extends string>({
  options,
  value,
  onChange,
  label,
  className,
}: {
  options: readonly (readonly [T, string])[];
  value: T | null;
  onChange: (value: T) => void;
  label?: string;
  className?: string;
}) {
  const name = useId();
  return (
    <div className={`seg${className ? ` ${className}` : ''}`} role="radiogroup" aria-label={label}>
      {options.map(([option, text]) => (
        <label key={option} className="seg-opt">
          <input type="radio" name={name} checked={value === option} onChange={() => onChange(option)} />
          {text}
        </label>
      ))}
    </div>
  );
}
