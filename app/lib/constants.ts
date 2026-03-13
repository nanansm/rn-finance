export const EXPENSE_CATEGORIES = [
  'Food',
  'Transport',
  'Groceries',
  'Utilities',
  'Health',
  'Entertainment',
  'Shopping',
  'Education',
  'Other',
  'Savings',
  'Investment',
  'Loan',
  'Debt',
  'Insurance',
  'Fee',
] as const;

export const INCOME_CATEGORIES = [
  'Salary',
  'Side Income',
  'Bonus',
  'Gift',
  'Interest',
  'Refund',
  'Business',
  'Rental',
  'Other Income',
] as const;

export const CATEGORIES = [...EXPENSE_CATEGORIES, ...INCOME_CATEGORIES] as const;

export const METHODS = ['Cash', 'BCA Debit'] as const;

export const SOURCES = ['Suami', 'Istri', 'Together'] as const;

export type Category = (typeof CATEGORIES)[number];
export type Method = (typeof METHODS)[number];
export type Source = (typeof SOURCES)[number];
