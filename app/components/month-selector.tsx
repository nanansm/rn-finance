interface MonthSelectorProps {
  months: string[];
  activeMonth: string;
  onChange: (month: string) => void;
}

function formatMonth(month: string): string {
  const date = new Date(month + '-01');
  return new Intl.DateTimeFormat('en-US', {
    year: 'numeric',
    month: 'long',
  }).format(date);
}

export function MonthSelector({
  months,
  activeMonth,
  onChange,
}: MonthSelectorProps) {
  const isSingle = months.length <= 1;

  return (
    <div className="relative inline-flex items-center gap-1 rounded-xl bg-slate-100 px-4 py-2">
      <span className="text-lg font-semibold text-slate-900">
        {formatMonth(activeMonth)}
      </span>
      {!isSingle && (
        <>
          <svg
            className="h-4 w-4 text-slate-400"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
            aria-hidden="true"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M19 9l-7 7-7-7"
            />
          </svg>
          <select
            value={activeMonth}
            onChange={(e) => onChange(e.target.value)}
            className="absolute inset-0 cursor-pointer opacity-0"
            aria-label="Select month"
          >
            {months.map((m) => (
              <option key={m} value={m}>
                {formatMonth(m)}
              </option>
            ))}
          </select>
        </>
      )}
    </div>
  );
}
