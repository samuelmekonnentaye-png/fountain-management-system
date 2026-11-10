export { escapeRegex } from './text.js';

export class HttpError extends Error {
  constructor(status, message, code) {
    super(message);
    this.status = status;
    if (code) this.code = code; // machine-readable reason, e.g. ACCOUNT_PENDING
  }
}
export const bad = (message) => new HttpError(400, message);
export const notFound = (message = 'Not found') => new HttpError(404, message);
export const forbidden = (message = 'Forbidden') => new HttpError(403, message);
export const conflict = (message) => new HttpError(409, message);

export const asyncHandler = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

export const isObjectId = (v) => /^[a-f\d]{24}$/i.test(String(v));
export const idOf = (x) => String(x?._id ?? x ?? '');
export const cleanStr = (v, max = 2000) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

export const toInt = (v, def, min, max) => {
  const n = parseInt(v, 10);
  if (Number.isNaN(n)) return def;
  return Math.min(max, Math.max(min, n));
};

export function paginate(query) {
  const page = toInt(query.page, 1, 1, 100000);
  const limit = toInt(query.limit, 20, 1, 100);
  return { page, limit, skip: (page - 1) * limit };
}
