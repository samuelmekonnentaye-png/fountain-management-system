import { env } from '../config/env.js';

export function notFoundHandler(req, res) {
  res.status(404).json({ message: `Route not found: ${req.method} ${req.originalUrl}` });
}

export function errorHandler(err, _req, res, _next) {
  let status = err.status || 500;
  let message = err.message || 'Server error';
  let details;

  if (err.name === 'ValidationError') {
    status = 400;
    details = Object.values(err.errors).map((e) => e.message);
    message = details[0];
  } else if (err.name === 'CastError') {
    status = 400;
    message = 'Invalid identifier';
  } else if (err.code === 11000) {
    status = 409;
    message = `Duplicate value for: ${Object.keys(err.keyPattern || {}).join(', ') || 'unique field'}`;
  } else if (err.name === 'VersionError') {
    status = 409;
    message = 'This record was changed by someone else. Reload the page and try again.';
  } else if (err.name === 'JsonWebTokenError' || err.name === 'TokenExpiredError') {
    status = 401;
    message = 'Your session has expired. Please sign in again';
  } else if (err.type === 'entity.parse.failed') {
    status = 400;
    message = 'Malformed request body';
  }

  if (status >= 500) console.error(err);
  res.status(status).json({
    message: status >= 500 && env.isProd ? 'Internal server error' : message,
    code: typeof err.code === 'string' && status < 500 ? err.code : undefined,
    details,
  });
}
