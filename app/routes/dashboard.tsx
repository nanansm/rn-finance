import { useMemo, useState } from 'react';
import {
  data,
  useLoaderData,
  useNavigate,
  useRouteError,
  isRouteErrorResponse,
} from 'react-router';
import { requireAuth } from '~/lib/auth.server';
import { resolveActiveMonth } from '~/lib/month.server';
import { selectedMonthCookie } from '~/lib/cookies.server';
import { getExpensesByMonth } from '~/lib/sheets.server';
import type { ExpenseEntry } from '~/lib/types';
import {
  INCOME_CATEGORIES,
  SOURCES,
  type Category,
  type Source,
} from '~/lib/constants';

type EntryType = 'income' | 'expense';

type DashboardEntry = ExpenseEntry & {
  entryType: EntryType;
};

type LoaderData =
  | {
      entries: DashboardEntry[];
      months: string[];
      activeMonth: string;
      offline?: false;
      error?: undefined;
    }
  | {
      entries: [];
      months: string[];
      activeMonth: string;
      offline: true;
      error?: undefined;
    }
  | {
      entries: DashboardEntry[];
      months: string[];
      activeMonth: string;
      offline?: false;
      error: string;
    };

export async function loader({ request }: { request: Request }) {
  await requireAuth(request);

  const url = new URL(request.url);
  const monthParam = url.searchParams.get('month');
  const cookieMonth = await selectedMonthCookie.parse(
    request.headers.get('Cookie'),
  );

  const { months, activeMonth, offline } = await resolveActiveMonth(
    monthParam ?? cookieMonth,
  );

  if (offline) {
    return data<LoaderData>({
      entries: [],
      activeMonth,
      months,
      offline: true,
    });
  }

  try {
    const rows = await getExpensesByMonth(activeMonth);
    const entries: DashboardEntry[] = rows.map((row) => {
      const category = (row[2] ?? '') as Category | '';
      const amount = Number(row[3]) || 0;
      const source = (row[6] ?? '') as Source | '';
      const entryType: EntryType = INCOME_CATEGORIES.includes(
        category as Category,
      )
        ? 'income'
        : 'expense';

      const base: ExpenseEntry = {
        timestamp: row[0] ?? '',
        item: row[1] ?? '',
        category: category || '',
        amount,
        method: row[4] ?? '',
        date: row[5] ?? '',
        source: source || '',
      };

      return { ...base, entryType };
    });

    return data<LoaderData>({
      entries,
      activeMonth,
      months,
    });
  } catch {
    return data<LoaderData>({
      entries: [],
      activeMonth,
      months,
      error: 'Failed to load dashboard data',
    });
  }
}

function formatCurrency(amount: number): string {
  return new Intl.NumberFormat('id-ID', {
    style: 'currency',
    currency: 'IDR',
    maximumFractionDigits: 0,
  }).format(amount);
}

const SOURCE_FILTERS: Array<{ id: 'All' | Source; label: string }> = [
  { id: 'All', label: 'All' },
  { id: 'Suami', label: 'Suami' },
  { id: 'Istri', label: 'Istri' },
  { id: 'Together', label: 'Together' },
];

export default function Dashboard() {
  const loaderData = useLoaderData<typeof loader>() as LoaderData;
  const navigate = useNavigate();

  const { months, activeMonth } = loaderData;
  const entries = loaderData.entries;
  const isOffline = loaderData.offline === true;
  const error = 'error' in loaderData ? loaderData.error : undefined;

  const [sourceFilter, setSourceFilter] = useState<'All' | Source>('All');
  const [activeCategory, setActiveCategory] = useState<string | null>(null);

  const filteredEntries = useMemo(() => {
    return entries.filter((e) => {
      if (sourceFilter !== 'All' && e.source !== sourceFilter) {
        return false;
      }
      return true;
    });
  }, [entries, sourceFilter]);

  const { totalIncome, totalExpense, balance } = useMemo(() => {
    let income = 0;
    let expense = 0;
    for (const e of filteredEntries) {
      if (e.entryType === 'income') income += e.amount;
      else expense += e.amount;
    }
    return {
      totalIncome: income,
      totalExpense: expense,
      balance: income - expense,
    };
  }, [filteredEntries]);

  const categorySummary = useMemo(() => {
    const map = new Map<string, { total: number; count: number }>();
    for (const e of filteredEntries) {
      const entry = map.get(e.category) ?? { total: 0, count: 0 };
      entry.total += e.amount;
      entry.count += 1;
      map.set(e.category, entry);
    }
    const list = Array.from(map.entries()).map(
      ([category, value]) => ({ category, ...value }),
    );
    list.sort((a, b) => b.total - a.total);
    return list;
  }, [filteredEntries]);

  const maxCategoryTotal = categorySummary[0]?.total ?? 0;

  const transactionsInActiveCategory = useMemo(() => {
    if (!activeCategory) return [];
    return filteredEntries.filter((e) => e.category === activeCategory);
  }, [filteredEntries, activeCategory]);

  function handleMonthChange(month: string) {
    navigate(`/dashboard?month=${month}`);
    setActiveCategory(null);
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col bg-white">
      <header className="px-4 flex justify-between items-center pt-[max(1.5rem,env(safe-area-inset-top))] pb-2 shrink-0">
        <h1 className="text-xl font-bold tracking-tight text-slate-900">
          Dashboard
        </h1>
        <div>
          <select
            className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-medium text-slate-700"
            value={activeMonth}
            onChange={(e) => handleMonthChange(e.target.value)}
          >
            {months.map((m) => (
              <option key={m} value={m}>
                {new Date(m + '-01').toLocaleDateString('en-US', {
                  month: 'long',
                  year: 'numeric',
                })}
              </option>
            ))}
          </select>
        </div>
      </header>

      {isOffline && (
        <div className="mx-4 mb-2 rounded-lg border border-amber-200 bg-amber-50 px-4 py-2 text-center text-sm text-amber-800">
          You're offline — dashboard data is unavailable until reconnected.
        </div>
      )}

      {/* Source filter */}
      <section className="px-4 pb-2">
        <div className="grid grid-cols-4 gap-1 rounded-xl bg-slate-100 p-1">
          {SOURCE_FILTERS.map((f) => (
            <button
              key={f.id}
              type="button"
              onClick={() => {
                setSourceFilter(f.id);
                setActiveCategory(null);
              }}
              className={`rounded-lg py-2 text-center text-xs font-medium transition-colors ${
                sourceFilter === f.id
                  ? 'bg-slate-900 text-white'
                  : 'text-slate-600'
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
      </section>

      {/* Summary cards */}
      <section className="px-4 pb-4 grid grid-cols-2 gap-3">
        <div className="col-span-1 rounded-2xl bg-emerald-50 px-4 py-3">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-emerald-700">
            Total Pemasukan
          </p>
          <p className="mt-1 text-lg font-bold text-emerald-900">
            {formatCurrency(totalIncome)}
          </p>
        </div>
        <div className="col-span-1 rounded-2xl bg-rose-50 px-4 py-3">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-rose-700">
            Total Pengeluaran
          </p>
          <p className="mt-1 text-lg font-bold text-rose-900">
            {formatCurrency(totalExpense)}
          </p>
        </div>
        <div className="col-span-2 rounded-2xl bg-slate-900 px-4 py-3">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-200">
            Sisa Saldo
          </p>
          <p className="mt-1 text-xl font-bold text-white">
            {formatCurrency(balance)}
          </p>
        </div>
      </section>

      {/* By Category */}
      <section className="flex-1 rounded-t-3xl bg-slate-50 px-4 pt-4 pb-[max(1.5rem,env(safe-area-inset-bottom))]">
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            By Category
          </h2>
          {filteredEntries.length > 0 && (
            <span className="text-[11px] text-slate-500">
              {filteredEntries.length} transaksi
            </span>
          )}
        </div>

        {error && (
          <p className="mb-2 text-sm text-red-600">{error}</p>
        )}

        {categorySummary.length === 0 && !error ? (
          <p className="text-sm text-slate-500">
            Belum ada transaksi di bulan ini untuk filter yang dipilih.
          </p>
        ) : (
          <div className="space-y-2">
            {categorySummary.map((c) => {
              const ratio =
                maxCategoryTotal > 0 ? c.total / maxCategoryTotal : 0;
              const isActive = activeCategory === c.category;
              return (
                <button
                  key={c.category}
                  type="button"
                  onClick={() =>
                    setActiveCategory(isActive ? null : c.category)
                  }
                  className={`w-full rounded-2xl border px-3 py-2 text-left transition-colors ${
                    isActive
                      ? 'border-slate-900 bg-white'
                      : 'border-slate-100 bg-white'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-xs font-semibold text-slate-900">
                        {c.category}
                      </p>
                      <p className="text-[11px] text-slate-500">
                        {c.count} transaksi
                      </p>
                    </div>
                    <p className="text-xs font-semibold text-slate-900">
                      {formatCurrency(c.total)}
                    </p>
                  </div>
                  <div className="mt-2 h-1.5 w-full rounded-full bg-slate-100">
                    <div
                      className="h-1.5 rounded-full bg-slate-900"
                      style={{ width: `${ratio * 100 || 4}%` }}
                    />
                  </div>
                </button>
              );
            })}
          </div>
        )}

        {activeCategory && transactionsInActiveCategory.length > 0 && (
          <div className="mt-4 rounded-2xl bg-white p-3 shadow-sm">
            <div className="mb-2 flex items-center justify-between">
              <div>
                <p className="text-xs font-semibold text-slate-900">
                  {activeCategory}
                </p>
                <p className="text-[11px] text-slate-500">
                  {transactionsInActiveCategory.length} transaksi
                </p>
              </div>
              <button
                type="button"
                onClick={() => setActiveCategory(null)}
                className="text-[11px] font-medium text-slate-500 underline"
              >
                Close
              </button>
            </div>
            <div className="space-y-2 max-h-64 overflow-y-auto">
              {transactionsInActiveCategory.map((t) => (
                <div
                  key={`${t.timestamp}-${t.item}`}
                  className="rounded-xl border border-slate-100 px-3 py-2"
                >
                  <div className="flex items-center justify-between">
                    <p className="text-xs font-semibold text-slate-900">
                      {t.item}
                    </p>
                    <p
                      className={`text-xs font-semibold ${
                        t.entryType === 'income'
                          ? 'text-emerald-700'
                          : 'text-rose-700'
                      }`}
                    >
                      {t.entryType === 'income' ? '+' : '-'}{' '}
                      {formatCurrency(t.amount)}
                    </p>
                  </div>
                  <div className="mt-1 flex items-center justify-between text-[11px] text-slate-500">
                    <span>
                      {new Date(t.date).toLocaleDateString('id-ID', {
                        day: '2-digit',
                        month: 'short',
                        year: 'numeric',
                      })}
                    </span>
                    <span>
                      {t.source} · {t.category}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </section>
    </main>
  );
}

export function ErrorBoundary() {
  const error = useRouteError();
  const isDev =
    typeof process !== 'undefined' &&
    process.env &&
    process.env.NODE_ENV === 'development';

  const message = isRouteErrorResponse(error)
    ? error.statusText || 'Something went wrong'
    : 'Something went wrong';

  const details =
    !isRouteErrorResponse(error) && error instanceof Error && isDev
      ? error.message
      : 'Could not load dashboard. Please try again.';

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col items-center justify-center bg-white px-6 text-center">
      <h1 className="text-xl font-bold text-slate-900">
        {message}
      </h1>
      <p className="mt-2 text-sm text-slate-500">{details}</p>
      <a
        href="/"
        className="mt-6 rounded-xl bg-slate-900 px-6 py-3 text-sm font-semibold text-white"
      >
        Go home
      </a>
    </main>
  );
}

