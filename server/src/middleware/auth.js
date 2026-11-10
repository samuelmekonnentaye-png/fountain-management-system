import User from '../models/User.js';
import { verifyToken } from '../utils/token.js';
import { HttpError } from '../utils/http.js';
import { accountBlock } from '../services/accountStatus.js';

export async function protect(req, _res, next) {
  try {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : null;
    if (!token) throw new HttpError(401, 'Please sign in to continue');

    const decoded = verifyToken(token);
    const user = await User.findById(decoded.id);
    if (!user || accountBlock(user)) throw new HttpError(401, 'This account is not available');

    // Tokens issued before a password change are no longer valid.
    if (user.passwordChangedAt && decoded.iat < Math.floor(user.passwordChangedAt.getTime() / 1000)) {
      throw new HttpError(401, 'Your password was changed. Please sign in again');
    }
    // A forced password change blocks everything except the auth endpoints.
    if (user.mustChangePassword && !req.originalUrl.startsWith('/api/auth/')) {
      throw new HttpError(403, 'You must change your password before continuing');
    }
    req.user = user;
    next();
  } catch (e) {
    next(e);
  }
}

// authorize('manager', 'general_manager') -> allowed when the user holds ANY of these roles.
export const authorize =
  (...roles) =>
  (req, _res, next) =>
    roles.some((r) => req.user.roles.includes(r))
      ? next()
      : next(new HttpError(403, 'You do not have permission to do this'));
