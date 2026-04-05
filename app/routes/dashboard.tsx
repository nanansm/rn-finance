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
      // PERBAIKAN: Cuci angka dari titik/koma agar tidak error NaN
      const amount = parseInt(String(row[3]).replace(/[^0-9]/g, ''), 10) || 0;
      const source = (row[6] ?? '') as Source | '';
      
      // PERBAIKAN: Deteksi entryType dari kolom H (index 7) dari Google Sheets
      const sheetType = String(row[7] || "").trim();
      const entryType: EntryType = sheetType.toLowerCase() === 'pemasukan' ? 'income' : 'expense';

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
  
  // PERBAIKAN: State untuk filter tab Tipe (All / Income / Expense) di list Category
  const [typeFilter, setTypeFilter] = useState<'all' | 'income' | 'expense'>('all');

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

  // PERBAIKAN: Category Summary yang sudah dipisah berdasarkan Pemasukan/Pengeluaran
  const categorySummary = useMemo(() => {
    const map = new Map<string, { total: number; count: number; type: EntryType }>();
    
    // Hanya kelompokkan data yang sesuai dengan typeFilter yang sedang aktif
    const entriesToGroup = filteredEntries.filter(e => 
        typeFilter === 'all' ? true : e.entryType === typeFilter
    );

    for (const e of entriesToGroup) {
      const entry = map.get(e.category) ?? { total: 0, count: 0, type: e.entryType };
      entry.total += e.amount;
      entry.count += 1;
      map.set(e.category, entry);
    }
    const list = Array.from(map.entries()).map(
      ([category, value]) => ({ category, ...value }),
    );
    list.sort((a, b) => b.total - a.total);
    return list;
  }, [filteredEntries, typeFilter]);

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
    <main className="mx-auto flex min-h-screen max-w-md flex-col bg-slate-50">
      <header className="px-4 flex justify-between items-center pt-[max(1.5rem,env(safe-area-inset-top))] pb-2 shrink-0 bg-white">
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
      <section className="px-4 pb-2 bg-white">
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
                  ? 'bg-slate-900 text-white shadow-sm'
                  : 'text-slate-600'
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
      </section>

      {/* Summary cards */}
      <section className="px-4 pb-4 grid grid-cols-2 gap-3 bg-white">
        <div className="col-span-1 rounded-2xl bg-emerald-50/80 px-4 py-4 border border-emerald-100">
          <p className="text-[10px] font-bold uppercase tracking-widest text-emerald-600">
            Pemasukan
          </p>
          <p className="mt-1 text-lg font-bold text-emerald-900">
            {formatCurrency(totalIncome)}
          </p>
        </div>
        <div className="col-span-1 rounded-2xl bg-rose-50/80 px-4 py-4 border border-rose-100">
          <p className="text-[10px] font-bold uppercase tracking-widest text-rose-600">
            Pengeluaran
          </p>
          <p className="mt-1 text-lg font-bold text-rose-900">
            {formatCurrency(totalExpense)}
          </p>
        </div>
        <div className="col-span-2 rounded-2xl bg-slate-900 px-4 py-5 shadow-md">
          <p className="text-[10px] font-medium uppercase tracking-widest text-slate-300">
            Sisa Saldo
          </p>
          <p className="mt-1 text-2xl font-bold text-white">
            {formatCurrency(balance)}
          </p>
        </div>
      </section>

      {/* By Category */}
      <section className="flex-1 rounded-t-3xl bg-white px-4 pt-4 pb-[max(1.5rem,env(safe-area-inset-bottom))] shadow-[0_-4px_24px_rgba(0,0,0,0.02)]">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-sm font-bold tracking-wide text-slate-900">
            Kategori
          </h2>
          
          {/* PERBAIKAN: Tombol Filter Pemasukan/Pengeluaran untuk list bawah */}
          <div className="flex bg-slate-100 rounded-lg p-1">
             <button
                onClick={() => setTypeFilter('all')}
                className={`px-3 py-1 text-[10px] font-semibold rounded-md transition-colors ${typeFilter === 'all' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500'}`}
             >Semua</button>
             <button
                onClick={() => setTypeFilter('expense')}
                className={`px-3 py-1 text-[10px] font-semibold rounded-md transition-colors ${typeFilter === 'expense' ? 'bg-rose-500 text-white shadow-sm' : 'text-slate-500'}`}
             >Keluar</button>
             <button
                onClick={() => setTypeFilter('income')}
                className={`px-3 py-1 text-[10px] font-semibold rounded-md transition-colors ${typeFilter === 'income' ? 'bg-emerald-500 text-white shadow-sm' : 'text-slate-500'}`}
             >Masuk</button>
          </div>
        </div>

        {error && (
          <p className="mb-2 text-sm text-red-600">{error}</p>
        )}

        {categorySummary.length === 0 && !error ? (
          <p className="text-sm text-center text-slate-400 py-8">
            Belum ada transaksi.
          </p>
        ) : (
          <div className="space-y-3">
            {categorySummary.map((c) => {
              const ratio =
                maxCategoryTotal > 0 ? c.total / maxCategoryTotal : 0;
              const isActive = activeCategory === c.category;
              const isIncome = c.type === 'income';
              
              return (
                <button
                  key={c.category}
                  type="button"
                  onClick={() =>
                    setActiveCategory(isActive ? null : c.category)
                  }
                  className={`w-full rounded-2xl border px-4 py-3 text-left transition-all ${
                    isActive
                      ? 'border-slate-300 bg-slate-50 shadow-sm'
                      : 'border-slate-100 bg-white hover:border-slate-200'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm font-semibold text-slate-800">
                        {c.category}
                      </p>
                      <p className="text-[11px] font-medium text-slate-400 mt-0.5">
                        {c.count} transaksi
                      </p>
                    </div>
                    <p className={`text-sm font-bold ${isIncome ? 'text-emerald-600' : 'text-slate-900'}`}>
                       {isIncome ? '+' : ''}{formatCurrency(c.total)}
                    </p>
                  </div>
                  <div className="mt-3 h-1.5 w-full rounded-full bg-slate-100 overflow-hidden">
                    <div
                      className={`h-full rounded-full transition-all duration-500 ${isIncome ? 'bg-emerald-400' : 'bg-slate-800'}`}
                      style={{ width: `${ratio * 100 || 4}%` }}
                    />
                  </div>
                </button>
              );
            })}
          </div>
        )}

        {activeCategory && transactionsInActiveCategory.length > 0 && (
          <div className="mt-4 rounded-2xl bg-slate-50 p-4 border border-slate-200">
            <div className="mb-3 flex items-center justify-between">
              <div>
                <p className="text-sm font-bold text-slate-900">
                  {activeCategory} Details
                </p>
              </div>
              <button
                type="button"
                onClick={() => setActiveCategory(null)}
                className="rounded-full bg-white px-3 py-1 text-[11px] font-semibold text-slate-600 shadow-sm border border-slate-200"
              >
                Tutup
              </button>
            </div>
            <div className="space-y-2 max-h-64 overflow-y-auto pr-1">
              {transactionsInActiveCategory.map((t) => (
                <div
                  key={`${t.timestamp}-${t.item}`}
                  className="rounded-xl bg-white border border-slate-100 px-3 py-3 shadow-sm"
                >
                  <div className="flex items-center justify-between">
                    <p className="text-sm font-semibold text-slate-800">
                      {t.item}
                    </p>
                    <p
                      className={`text-sm font-bold ${
                        t.entryType === 'income'
                          ? 'text-emerald-600'
                          : 'text-slate-900'
                      }`}
                    >
                      {t.entryType === 'income' ? '+' : '-'}{' '}
                      {formatCurrency(t.amount)}
                    </p>
                  </div>
                  <div className="mt-1 flex items-center justify-between text-[11px] font-medium text-slate-400">
                    <span>
                      {new Date(t.date).toLocaleDateString('id-ID', {
                        day: '2-digit',
                        month: 'short',
                        year: 'numeric',
                      })}
                    </span>
                    <span className="bg-slate-100 px-2 py-0.5 rounded-md text-slate-500">
                      {t.source}
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