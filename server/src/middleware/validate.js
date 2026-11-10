import { HttpError } from '../utils/http.js';

const toError = (err) => {
  const issue = err.issues[0];
  const path = issue.path.filter((p) => typeof p === 'string').join('.');
  return new HttpError(400, path && path !== issue.message ? `${path}: ${issue.message}` : issue.message);
};

// validate(zodSchema) parses req.body; unknown fields are stripped.
export const validate = (schema) => (req, _res, next) => {
  const result = schema.safeParse(req.body ?? {});
  if (!result.success) return next(toError(result.error));
  req.body = result.data;
  return next();
};
