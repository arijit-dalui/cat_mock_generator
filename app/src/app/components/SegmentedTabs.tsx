/** The pill-button tab group used for every mode/section/view switcher in
 * the app (Sectional vs Full Mock, VA/RC/DI/LR/QA, Individual vs
 * Comparative, the Revise section filter). One active style everywhere -
 * brand blue - instead of each page inventing its own. */
export default function SegmentedTabs<T extends string>({
  options,
  value,
  onChange,
  labels,
}: {
  options: readonly T[];
  value: T;
  onChange: (v: T) => void;
  /** Override the button text for specific options; falls back to the
   * option value itself (capitalized via CSS if needed by the caller). */
  labels?: Partial<Record<T, string>>;
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {options.map((opt) => (
        <button
          key={opt}
          onClick={() => onChange(opt)}
          className={
            "rounded-sm px-4 py-2 text-sm font-semibold transition-colors " +
            (value === opt
              ? "bg-brand text-white"
              : "border border-slate-300 bg-white text-slate-600 hover:bg-slate-50")
          }
        >
          {labels?.[opt] ?? opt}
        </button>
      ))}
    </div>
  );
}
