// Pure rules (no database): who is the superior of a person, and which approvers does a report pass?
//
//  1. An explicit "manager" on the user always wins.
//  2. Otherwise the superior is the holder of the position above (the chart). If several people hold that
//     position, the one in the same unit is used; if it is still not unique the superior cannot be decided
//     automatically ("ambiguous") and the administrator must set the manager. Vacant positions are skipped.
//  3. The chain only contains approvers (positions with approver=true) on the sender's OWN line of command,
//     and it stops at the position marked chainEnd (the General Manager).

import { idStr } from './workflow.js';

export const MAX_DEPTH = 8;
const MAX_POSITION_HOPS = 20;

// users: [{ _id, manager, position, department, isActive, roles }]   positions: [{ _id, name, parent, approver, chainEnd }]
export function buildIndex(users, positions) {
  const usersById = new Map(users.map((u) => [idStr(u._id), u]));
  const positionsById = new Map(positions.map((p) => [idStr(p._id), p]));
  const holdersByPosition = new Map();
  for (const u of users) {
    if (u.isActive === false || !u.position) continue;
    const key = idStr(u.position);
    if (!holdersByPosition.has(key)) holdersByPosition.set(key, []);
    holdersByPosition.get(key).push(u);
  }
  return { usersById, positionsById, holdersByPosition };
}

// -> { boss, status: 'manager' | 'position' | 'top' | 'ambiguous' | 'unassigned', position? }
export function bossOf(user, idx) {
  if (user.manager) {
    const m = idx.usersById.get(idStr(user.manager));
    if (m && m.isActive !== false) return { boss: m, status: 'manager' };
  }
  const own = user.position ? idx.positionsById.get(idStr(user.position)) : null;
  if (!own) return { boss: null, status: 'unassigned' };

  let cur = own;
  for (let hops = 0; cur?.parent && hops < MAX_POSITION_HOPS; hops += 1) {
    const parent = idx.positionsById.get(idStr(cur.parent));
    if (!parent) break;
    let holders = (idx.holdersByPosition.get(idStr(parent._id)) || []).filter((h) => idStr(h._id) !== idStr(user._id));
    if (holders.length > 1 && user.department) {
      const sameUnit = holders.filter((h) => idStr(h.department) === idStr(user.department));
      if (sameUnit.length === 1) holders = sameUnit;
    }
    if (holders.length === 1) return { boss: holders[0], status: 'position', position: parent };
    if (holders.length > 1) return { boss: null, status: 'ambiguous', position: parent };
    cur = parent; // vacant: look one level further up
  }
  return { boss: null, status: 'top' };
}

// -> { ids: [userId...], stop: 'top' | 'chainEnd' | 'ambiguous' | 'unassigned' | 'loop' | 'depth', position? }
export function resolveChain(ownerId, idx, maxDepth = MAX_DEPTH) {
  const ids = [];
  const seen = new Set([idStr(ownerId)]);
  let cur = idx.usersById.get(idStr(ownerId));
  let stop = 'top';
  let position;
  for (let i = 0; cur; i += 1) {
    if (i >= maxDepth) { stop = 'depth'; break; }
    const r = bossOf(cur, idx);
    if (!r.boss) {
      stop = r.status;
      position = r.position;
      break;
    }
    const bid = idStr(r.boss._id);
    if (seen.has(bid)) { stop = 'loop'; break; }
    seen.add(bid);
    const pos = r.boss.position ? idx.positionsById.get(idStr(r.boss.position)) : null;
    if (!pos || pos.approver !== false) ids.push(bid);
    if (pos?.chainEnd) { stop = 'chainEnd'; break; }
    cur = r.boss;
  }
  return { ids, stop, position };
}

// Does this person need the administrator's attention (superior unknown)?
export function needsSuperior(user, idx) {
  const roles = user.roles || [];
  if (roles.includes('general_manager') || roles.includes('system_admin')) return false;
  const r = bossOf(user, idx);
  return r.status === 'ambiguous' || r.status === 'unassigned';
}
