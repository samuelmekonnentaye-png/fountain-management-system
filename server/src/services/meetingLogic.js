// Pure meeting rules (no database), so they can be unit-tested.
import { idStr } from './workflow.js';

export const HEAD_ROLES = ['department_head', 'manager', 'deputy_general_manager', 'general_manager'];
export const JOIN_OPENS_MINUTES_BEFORE = 15;

export const endsAt = (startsAt, minutes) => new Date(new Date(startsAt).getTime() + Number(minutes) * 60000);
export const overlaps = (aStart, aEnd, bStart, bEnd) => new Date(aStart) < new Date(bEnd) && new Date(bStart) < new Date(aEnd);

// The chosen units and (optionally) everything below them in the department structure.
export function collectDepartmentIds(rootIds, departments, includeSubunits = true) {
  const ids = new Set(rootIds.map(idStr));
  if (!includeSubunits) return ids;
  let grew = true;
  while (grew) {
    grew = false;
    for (const d of departments) {
      if (d.parent && ids.has(idStr(d.parent)) && !ids.has(idStr(d._id))) {
        ids.add(idStr(d._id));
        grew = true;
      }
    }
  }
  return ids;
}

// A "head": a person with a leading role, or a holder of an approver position of the organisation chart.
export const isHead = (user, positionsById) =>
  (user.roles || []).some((r) => HEAD_ROLES.includes(r)) ||
  Boolean(user.position && positionsById?.get(idStr(user.position))?.approver === true);

// Who is invited? Units (everybody or heads only) + single people + the organizer.
// `existing` keeps earlier answers when a meeting is edited.
export function expandInvites({ invites = [], invitedUserIds = [], organizerId, users, departments = [], positionsById = new Map(), existing = [] }) {
  const previous = new Map(existing.map((p) => [idStr(p.user), p]));
  const result = new Map();
  const add = (user, source, department = null) => {
    const id = idStr(user._id);
    if (result.has(id)) return;
    const old = previous.get(id);
    result.set(id, {
      user: user._id,
      source,
      department,
      status: old?.status || 'invited',
      respondedAt: old?.respondedAt || null,
      attended: old?.attended || false,
    });
  };

  const organizer = users.find((u) => idStr(u._id) === idStr(organizerId));
  if (organizer) {
    add(organizer, 'organizer');
    result.get(idStr(organizer._id)).status = 'accepted';
  }
  for (const inv of invites) {
    const unitIds = collectDepartmentIds([inv.departmentId], departments, inv.includeSubunits !== false);
    for (const u of users) {
      if (u.isActive === false || !u.department || !unitIds.has(idStr(u.department))) continue;
      if (inv.scope === 'heads' && !isHead(u, positionsById)) continue;
      add(u, 'department', inv.departmentId);
    }
  }
  for (const id of invitedUserIds) {
    const u = users.find((x) => idStr(x._id) === idStr(id));
    if (u && u.isActive !== false) add(u, 'user');
  }
  return [...result.values()];
}

// 'upcoming' | 'live' | 'ended' | 'cancelled'
export function phaseOf(meeting, now = new Date()) {
  if (meeting.status === 'cancelled') return 'cancelled';
  if (meeting.status === 'completed') return 'ended';
  const start = new Date(meeting.startsAt);
  const end = new Date(meeting.endsAt || endsAt(meeting.startsAt, meeting.durationMinutes || 60));
  if (now < start) return 'upcoming';
  return now <= end ? 'live' : 'ended';
}

// The "Join" button becomes active shortly before the start and stays until the end.
export function joinWindowOpen(meeting, now = new Date()) {
  if (meeting.status !== 'scheduled') return false;
  const start = new Date(meeting.startsAt).getTime() - JOIN_OPENS_MINUTES_BEFORE * 60000;
  const end = new Date(meeting.endsAt || endsAt(meeting.startsAt, meeting.durationMinutes || 60)).getTime();
  return now.getTime() >= start && now.getTime() <= end;
}

export const respondable = (meeting, now = new Date()) => meeting.status === 'scheduled' && phaseOf(meeting, now) !== 'ended';
