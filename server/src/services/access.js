import User from '../models/User.js';
import { scopeKind } from '../config/roles.js';
import { forbidden } from '../utils/http.js';

// Which employees' performance numbers may this user see?
//  { all: true }         General Manager / Deputy GM
//  { ownerIds: [...] }   Manager / Department Head: own department + direct reports (+ self)
export async function analyticsScope(user) {
  const kind = scopeKind(user.roles);
  if (kind === 'all') return { all: true };
  if (kind === 'team') {
    const or = [{ manager: user._id }];
    if (user.department) or.push({ department: user.department });
    const ids = await User.distinct('_id', { $or: or, isActive: true });
    return { ownerIds: [...ids, user._id] };
  }
  throw forbidden('You do not have access to team performance');
}
