import { z } from 'zod';

export const oid = z.string().regex(/^[a-f\d]{24}$/i, 'Invalid identifier');
export const nullableId = z
  .union([oid, z.literal(''), z.null()])
  .transform((v) => v || null);
export const text = (max) => z.string().trim().max(max, `Must be at most ${max} characters`);
export const dateValue = z.union([z.literal(''), z.null(), z.coerce.date()]).transform((v) => v || null);

export const password = z
  .string()
  .min(10, 'Password must be at least 10 characters')
  .max(64, 'Password must be at most 64 characters')
  .refine((p) => /[A-Za-z]/.test(p) && /\d/.test(p), 'Password must contain both letters and numbers');

export const email = z.string().trim().toLowerCase().email('Please enter a valid email address').max(150);
