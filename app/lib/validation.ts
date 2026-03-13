import { z } from 'zod';
import { CATEGORIES, METHODS, SOURCES } from './constants';

export const expenseSchema = z.object({
  month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Invalid month'),
  item: z.string().min(1, 'Item is required').max(100, 'Item too long'),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Invalid date format'),
  amount: z
    .string()
    .min(1, 'Amount is required')
    .transform(Number)
    .pipe(z.number().positive('Amount must be positive')),
  category: z.enum(CATEGORIES, { message: 'Pick a category' }),
  method: z.enum(METHODS, { message: 'Pick a payment method' }),
  source: z.enum(SOURCES, { message: 'Select a source' }),
  entryType: z.enum(['expense', 'income']).default('expense'),
});

export type ExpenseInput = z.input<typeof expenseSchema>;
export type ExpenseData = z.output<typeof expenseSchema>;
