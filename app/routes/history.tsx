import { useReducer, useEffect, useCallback, useState } from 'react';
import {
  data,
  useLoaderData,
  useNavigate,
  useRouteError,
  isRouteErrorResponse,
} from 'react-router';
import type { Route } from './+types/history';
import { getExpensesByMonth } from '~/lib/sheets.server';
import { requireAuth } from '~/lib/auth.server';
import { resolveActiveMonth } from '~/lib/month.server';
import { selectedMonthCookie } from '~/lib/cookies.server';
import type { ExpenseEntry } from '~/lib/types';
import { INCOME_CATEGORIES, type Category } from '~/lib/constants';

function formatCurrency(amount: number): string {
  return new Intl.NumberFormat('id-ID', {
    style: 'currency',
    currency: 'IDR',
    maximumFractionDigits: 0,
  }).format(amount);
}
import { ExpenseCard } from '~/components/expense-card';
import { MonthSelector } from '~/components/month-selector';
import { getPendingCount } from '~/lib/offline-queue';
import { syncPendingExpenses } from '~/lib/sync';
import { toast } from 'sonner';

export async function loader({ request }: Route.LoaderArgs) {
  await requireAuth(request);

  const url = new URL(request.url);
  const monthParam = url.searchParams.get('month');
  const viewParam = url.searchParams.get('view');
  const cookieMonth = await selectedMonthCookie.parse(
    request.headers.get('Cookie'),
  );

  const { months, activeMonth, offline } = await resolveActiveMonth(
    monthParam ?? cookieMonth,
  );

  const view =
    viewParam === 'dashboard' ? 'dashboard' : 'history';

  if (offline) {
    return data({
      entries: [] as ExpenseEntry[],
      activeMonth,
      months,
      view,
      offline: true,
    });
  }

  try {
    // PERBAIKAN 1: Hapus limit agar semua data terbaca dari baris atas sampai bawah
    const rows = await getExpensesByMonth(activeMonth);
    
    const entries: ExpenseEntry[] = rows.map((row) => {
      // PERBAIKAN 2: Cuci angka dari titik/koma (agar tidak IDR 0)
      const amount = parseInt(String(row[3]).replace(/[^0-9]/g, ''), 10) || 0;
      
      // PERBAIKAN 3: Deteksi entryType dari kolom H (index 7) untuk ExpenseCard nanti
      const sheetType = String(row[7] || "").trim();
      const entryType = sheetType.toLowerCase() === 'pemasukan' ? 'income' : 'expense';

      return {
        timestamp: row[0] ?? '',
        item: row[1] ?? '',
        category: row[2] ?? '',
        amount: amount,
        method: row[4] ?? '',
        date: row[5] ?? '',
        source: row[6] ?? '',
        entryType: entryType, // Kita sertakan entryType-nya
      };
    });
    
    return data({ entries, activeMonth, months, view });
  } catch {
    return data({
      entries: [] as ExpenseEntry[],
      activeMonth,
      months,
      view,
      error: 'Failed to load expenses',
    });
  }
}

export default function History() {
  const loaderData = useLoaderData<typeof loader>();
  const error =
    'error' in loaderData ? (loaderData.error as string) : null;
  const isOffline =
    'offline' in loaderData ? (loaderData.offline as boolean) : false;
  const entries = loaderData.entries as ExpenseEntry[];
  const activeMonth = loaderData.activeMonth as string;
  const months = loaderData.months as string[];
  const view =
    'view' in loaderData && loaderData.view === 'dashboard'
      ? 'dashboard'
      : 'history';
  const navigate = useNavigate();

  type State = {
    sourceFilter: string;
    pendingCount: number;
    isOnline: boolean;
    isSyncing: boolean;
    cachedEntries: ExpenseEntry[];
  };
  type Action =
    | { type: 'SET_SOURCE_FILTER'; filter: string }
    | { type: 'SET_PENDING_COUNT'; count: number }
    | { type: 'SET_ONLINE'; online: boolean }
    | { type: 'SET_SYNCING'; syncing: boolean }
    | { type: 'SET_CACHED_ENTRIES'; entries: ExpenseEntry[] };

  const [state, dispatch] = useReducer(
    (s: State, a: Action): State => {
      switch (a.type) {
        case 'SET_SOURCE_FILTER': return { ...s, sourceFilter: a.filter };
        case 'SET_PENDING_COUNT': return { ...s, pendingCount: a.count };
        case 'SET_ONLINE': return { ...s, isOnline: a.online };
        case 'SET_SYNCING': return { ...s, isSyncing: a.syncing };
        case 'SET_CACHED_ENTRIES': return { ...s, cachedEntries: a.entries };
      }
    },
    {
      sourceFilter: 'All',
      pendingCount: 0,
      isOnline: true,
      isSyncing: false,
      cachedEntries: [],
    },
  );
  const { sourceFilter, pendingCount, isOnline, isSyncing, cachedEntries } = state;

  const [activeCategory, setActiveCategory] =
    useState<string | null>(null);

  const refreshPendingCount = useCallback(async () => {
    try {
      const count = await getPendingCount();
      dispatch({ type: 'SET_PENDING_COUNT', count });
    } catch {
      // IndexedDB not available
    }
  }, []);

  useEffect(() => {
    dispatch({ type: 'SET_ONLINE', online: navigator.onLine });
    refreshPendingCount();

    const handleOnline = () => dispatch({ type: 'SET_ONLINE', online: true });
    const handleOffline = () => dispatch({ type: 'SET_ONLINE', online: false });

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, [refreshPendingCount]);

  // Persist entries to localStorage when loaded successfully
  useEffect(() => {
    if (isOffline || entries.length === 0) return;
    try {
      localStorage.setItem(
        `duitlog-history-${activeMonth}`,
        JSON.stringify(entries),
      );
    } catch {
      // Storage quota exceeded or unavailable
    }
  }, [entries, activeMonth, isOffline]);

  // Load cached entries from localStorage when offline
  useEffect(() => {
    if (!isOffline) return;
    try {
      const cached = localStorage.getItem(`duitlog-history-${activeMonth}`);
      if (cached) {
        dispatch({ type: 'SET_CACHED_ENTRIES', entries: JSON.parse(cached) });
      }
    } catch {
      // localStorage unavailable
    }
  }, [isOffline, activeMonth]);

  // Auto-sync when online with pending entries
  useEffect(() => {
    if (!isOnline || pendingCount === 0 || isSyncing) return;

    dispatch({ type: 'SET_SYNCING', syncing: true });
    syncPendingExpenses((synced, total) => {
      dispatch({ type: 'SET_PENDING_COUNT', count: total - synced });
    })
      .then(({ synced, failed }) => {
        refreshPendingCount();
        if (synced > 0) {
          toast.success(
            `Synced ${synced} expense${synced > 1 ? 's' : ''} to Google Sheets${failed > 0 ? ` (${failed} failed)` : ''}`,
          );
        }
      })
      .catch((error) => {
        console.error('Failed to sync pending expenses', error);
        toast.error('Failed to sync pending expenses. Please try again.');
      })
      .finally(() => {
        dispatch({ type: 'SET_SYNCING', syncing: false });
      });
  }, [isOnline, pendingCount, isSyncing, refreshPendingCount]);

  function handleMonthChange(month: string) {
    const viewQuery =
      view === 'dashboard' ? '&view=dashboard' : '';
    navigate(`/history?month=${month}${viewQuery}`);
  }

  const displayEntries = isOffline && cachedEntries.length > 0 ? cachedEntries : entries;
  const isShowingCached = isOffline && cachedEntries.length > 0;
  const filtered =
    sourceFilter === 'All'
      ? displayEntries
      : displayEntries.filter((e) => e.source === sourceFilter);

  const isDashboardView = view === 'dashboard';

  let totalIncome = 0;
  let totalExpense = 0;
  const categoryMap = new Map<string, { total: number; count: number }>();

  if (isDashboardView) {
    for (const e of filtered) {
      const isIncome = INCOME_CATEGORIES.includes(
        e.category as Category & (typeof INCOME_CATEGORIES)[number],
      );
      const amount = e.amount || 0;
      if (isIncome) totalIncome += amount;
      else totalExpense += amount;

      const catKey = e.category || (isIncome ? 'Income' : 'Other');
      const existing = categoryMap.get(catKey) ?? {
        total: 0,
        count: 0,
      };
      existing.total += amount;
      existing.count += 1;
      categoryMap.set(catKey, existing);
    }
  }

  const categorySummary = isDashboardView
    ? Array.from(categoryMap.entries())
        .map(([category, value]) => ({ category, ...value }))
        .sort((a, b) => b.total - a.total)
    : [];

  const maxCategoryTotal = categorySummary[0]?.total ?? 0;

  const transactionsInActiveCategory =
    isDashboardView && activeCategory
      ? filtered.filter((e) => e.category === activeCategory)
      : [];

  const balance = totalIncome - totalExpense;

  if (isDashboardView) {
    return (
      <main className="mx-auto flex min-h-screen max-w-md flex-col bg-white">
        <header className="flex justify-between items-center shrink-0 px-4 pt-[max(1.5rem,env(safe-area-inset-top))] pb-2">
          <h1 className="text-xl font-bold tracking-tight text-slate-900">
            Dashboard
          </h1>
          <div className="mt-2">
            <MonthSelector
              months={months}
              activeMonth={activeMonth}
              onChange={handleMonthChange}
            />
          </div>
        </header>

        {isOffline && (
          <div className="mx-4 mb-2 rounded-lg border border-amber-200 bg-amber-50 px-4 py-2 text-center text-sm text-amber-800">
            You're offline — dashboard data is unavailable until reconnected.
          </div>
        )}

        <section className="px-4 pb-2">
          <div className="grid grid-cols-4 gap-1 rounded-xl bg-slate-100 p-1">
            {['All', 'Suami', 'Istri', 'Together'].map((s) => (
              <button
                key={s}
                onClick={() => {
                  dispatch({ type: 'SET_SOURCE_FILTER', filter: s });
                  setActiveCategory(null);
                }}
                className={`rounded-lg py-2 text-center text-xs font-medium transition-colors ${
                  sourceFilter === s
                    ? 'bg-slate-900 text-white'
                    : 'text-slate-600'
                }`}
              >
                {s}
              </button>
            ))}
          </div>
        </section>

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

        <section className="flex-1 rounded-t-3xl bg-slate-50 px-4 pt-4 pb-[max(1.5rem,env(safe-area-inset-bottom))]">
          <div className="mb-2 flex items-center justify-between">
            <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              By Category
            </h2>
            {filtered.length > 0 && (
              <span className="text-[11px] text-slate-500">
                {filtered.length} transaksi
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
                      setActiveCategory(
                        isActive ? null : c.category,
                      )
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

          {activeCategory &&
            transactionsInActiveCategory.length > 0 && (
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
                  {transactionsInActiveCategory.map((t, i) => (
                    <div
                      key={`${t.timestamp}-${i}`}
                      className="rounded-xl border border-slate-100 px-3 py-2"
                    >
                      <div className="flex items-center justify-between">
                        <p className="text-xs font-semibold text-slate-900">
                          {t.item}
                        </p>
                        <p className="text-xs font-semibold text-slate-900">
                          {formatCurrency(t.amount)}
                        </p>
                      </div>
                      <div className="mt-1 flex items-center justify-between text-[11px] text-slate-500">
                        <span>{t.date}</span>
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

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col bg-white">
      <header className="flex justify-between items-center shrink-0 px-4 pt-[max(1.5rem,env(safe-area-inset-top))] pb-2">
        <h1 className="text-xl font-bold tracking-tight text-slate-900">
          Recent Expenses
        </h1>
        <div className="mt-2">
          <MonthSelector
            months={months}
            activeMonth={activeMonth}
            onChange={handleMonthChange}
          />
        </div>
      </header>

      {isOffline && (
        <div className="mx-4 mb-2 rounded-lg border border-amber-200 bg-amber-50 px-4 py-2 text-center text-sm text-amber-800">
          {isShowingCached
            ? "You're offline — showing last loaded data."
            : "You're offline — history unavailable until reconnected."}
        </div>
      )}

      {pendingCount > 0 && (
        <div className="mx-4 mb-2 flex items-center justify-center gap-2 rounded-lg border border-blue-200 bg-blue-50 px-4 py-2 text-center text-sm text-blue-800">
          <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-blue-500 text-xs font-bold text-white">
            {pendingCount}
          </span>
          {isSyncing ? 'Syncing...' : `pending expense${pendingCount > 1 ? 's' : ''} — not yet in history`}
        </div>
      )}

      <div className="grid grid-cols-4 gap-1 px-4 pb-2">
        {['All', 'Suami', 'Istri', 'Together'].map((s) => (
          <button
            key={s}
            onClick={() => dispatch({ type: 'SET_SOURCE_FILTER', filter: s })}
            className={`rounded-lg py-1.5 text-xs font-medium transition-colors ${
              sourceFilter === s
                ? 'bg-slate-900 text-white'
                : 'bg-slate-100 text-slate-600'
            }`}
          >
            {s}
          </button>
        ))}
      </div>

      {error && <p className="px-4 text-sm text-red-600">{error}</p>}

      {filtered.length === 0 && !error ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 px-4 text-center">
          <span className="text-5xl">🧾</span>
          <p className="text-lg font-semibold text-slate-700">
            {isOffline ? 'No cached history for this month' : 'No expenses yet'}
          </p>
          <p className="text-sm text-slate-400">
            {isOffline
              ? 'Visit this month while online to cache it.'
              : 'Start logging your expenses from the Add tab.'}
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-2 px-4 pt-2 pb-4">
          {filtered.map((entry, i) => (
            <ExpenseCard
              key={`${entry.timestamp}-${i}`}
              entry={entry}
            />
          ))}
        </div>
      )}
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
    : error instanceof Error
      ? isDev
        ? error.message
        : 'Something went wrong'
      : 'Something went wrong';

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col items-center justify-center bg-white px-6 text-center">
      <h1 className="text-xl font-bold text-slate-900">
        Something went wrong
      </h1>
      <p className="mt-2 text-sm text-slate-500">{message}</p>
      <a
        href="/"
        className="mt-6 rounded-xl bg-slate-900 px-6 py-3 text-sm font-semibold text-white"
      >
        Go home
      </a>
    </main>
  );
}
