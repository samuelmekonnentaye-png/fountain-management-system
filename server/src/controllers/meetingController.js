import Meeting from '../models/Meeting.js';
import User from '../models/User.js';
import Department from '../models/Department.js';
import Position from '../models/Position.js';
import { TEAM_ROLES, hasRole } from '../config/roles.js';
import { asyncHandler, bad, conflict, forbidden, idOf, isObjectId, notFound, paginate } from '../utils/http.js';
import { notify, audit } from '../services/notify.js';
import { endsAt as calcEnd, expandInvites, joinWindowOpen, phaseOf, respondable } from '../services/meetingLogic.js';

// Who may organize meetings: department heads, managers, deputy GM, GM (the System Admin only administers).
export const canOrganize = (user) => hasRole(user, ...TEAM_ROLES);

async function loadPeople() {
  const [users, departments, positions] = await Promise.all([
    User.find({ approvalStatus: { $nin: ['pending', 'rejected'] }, isActive: true }).select('fullName department position roles isActive').lean(),
    Department.find().select('name nameAm parent').lean(),
    Position.find().select('approver').lean(),
  ]);
  return { users, departments, positionsById: new Map(positions.map((p) => [idOf(p._id), p])) };
}

async function expand(body, organizerId, existing = []) {
  const people = await loadPeople();
  const ids = (body.invites || []).map((i) => i.departmentId);
  if (ids.length && (await Department.countDocuments({ _id: { $in: ids } })) !== new Set(ids.map(String)).size) {
    throw bad('One of the invited departments was not found');
  }
  const participants = expandInvites({
    invites: body.invites || [], invitedUserIds: body.invitedUserIds || [], organizerId,
    users: people.users, departments: people.departments, positionsById: people.positionsById, existing,
  });
  return { participants, people };
}

// people who are already in another meeting at the same time (a warning, not a block)
async function findConflicts(participantIds, startsAt, endsAt, excludeId, people) {
  const filter = {
    status: 'scheduled',
    startsAt: { $lt: endsAt }, endsAt: { $gt: startsAt },
    'participants.user': { $in: participantIds },
  };
  if (excludeId) filter._id = { $ne: excludeId };
  const others = await Meeting.find(filter).select('title participants.user participants.status').lean();
  const names = new Map(people.users.map((u) => [idOf(u._id), u.fullName]));
  const wanted = new Set(participantIds.map(idOf));
  const out = [];
  for (const m of others) {
    for (const p of m.participants) {
      if (wanted.has(idOf(p.user)) && p.status !== 'declined') out.push({ name: names.get(idOf(p.user)) || '', title: m.title });
    }
  }
  return out.slice(0, 30);
}

function summarize(m, uid, now = new Date()) {
  const mine = m.participants.find((p) => idOf(p.user) === uid);
  return {
    _id: m._id,
    title: m.title,
    startsAt: m.startsAt,
    endsAt: m.endsAt,
    channel: m.channel,
    status: m.status,
    phase: phaseOf(m, now),
    hostDepartment: m.hostDepartment || null,
    organizer: m.organizer,
    isOrganizer: idOf(m.organizer) === uid,
    myStatus: mine?.status || null,
    participantCount: m.participants.length,
    acceptedCount: m.participants.filter((p) => p.status === 'accepted').length,
    hasLink: Boolean(m.joinUrl),
    joinOpen: joinWindowOpen(m, now),
    location: m.location,
  };
}

async function loadMeeting(req, { populate = false } = {}) {
  if (!isObjectId(req.params.id)) throw notFound('Meeting not found');
  let q = Meeting.findById(req.params.id);
  if (populate) {
    q = q
      .populate('organizer', 'fullName jobTitle')
      .populate('hostDepartment', 'name nameAm')
      .populate('participants.user', 'fullName jobTitle')
      .populate('participants.department', 'name nameAm')
      .populate('invites.department', 'name nameAm')
      .populate('invitedUsers', 'fullName')
      .populate('actions.owner', 'fullName');
  }
  const m = await q;
  if (!m) throw notFound('Meeting not found');
  const uid = idOf(req.user._id);
  const isOrganizer = idOf(m.organizer) === uid;
  const mine = m.participants.find((p) => idOf(p.user) === uid);
  if (!isOrganizer && !mine) throw forbidden('You are not invited to this meeting');
  return { m, isOrganizer, mine };
}

const meetingLink = (m) => ({ meeting: m._id });
const when = (d) => new Date(d).toISOString();

// ------------------------------------------------------------------ list
export const listMeetings = asyncHandler(async (req, res) => {
  const uid = req.user._id;
  const now = new Date();
  const { page, limit, skip } = paginate(req.query);
  const mineFilter = { $or: [{ organizer: uid }, { 'participants.user': uid }] };
  const scope = req.query.scope || 'upcoming';
  let filter = mineFilter;
  let sort = { startsAt: 1 };
  if (scope === 'upcoming') {
    filter = { $and: [mineFilter, { status: 'scheduled', endsAt: { $gte: now } }] };
  } else if (scope === 'past') {
    filter = { $and: [mineFilter, { $or: [{ endsAt: { $lt: now } }, { status: { $in: ['completed', 'cancelled'] } }] }] };
    sort = { startsAt: -1 };
  } else if (scope === 'organized') {
    filter = { organizer: uid };
    sort = { startsAt: -1 };
  }

  const [items, total] = await Promise.all([
    Meeting.find(filter)
      .sort(sort).skip(skip).limit(limit)
      .select('title startsAt endsAt channel status hostDepartment organizer participants.user participants.status joinUrl location')
      .populate('hostDepartment', 'name nameAm')
      .populate('organizer', 'fullName')
      .lean(),
    Meeting.countDocuments(filter),
  ]);
  res.json({ items: items.map((m) => summarize(m, idOf(uid), now)), total, page, pages: Math.max(1, Math.ceil(total / limit)) });
});

export const meetingStats = asyncHandler(async (req, res) => {
  const now = new Date();
  const startOfDay = new Date(now);
  startOfDay.setHours(0, 0, 0, 0);
  const endOfDay = new Date(startOfDay.getTime() + 86400000);
  const [awaiting, today] = await Promise.all([
    Meeting.countDocuments({ status: 'scheduled', endsAt: { $gte: now }, participants: { $elemMatch: { user: req.user._id, status: 'invited' } } }),
    Meeting.countDocuments({
      status: 'scheduled', startsAt: { $gte: startOfDay, $lt: endOfDay },
      $or: [{ organizer: req.user._id }, { 'participants.user': req.user._id }],
    }),
  ]);
  res.json({ awaiting, today });
});

// ------------------------------------------------------------------ one meeting
export const getMeeting = asyncHandler(async (req, res) => {
  const { m, isOrganizer, mine } = await loadMeeting(req, { populate: true });
  const now = new Date();
  res.json({
    meeting: m.toObject(),
    phase: phaseOf(m, now),
    joinOpen: joinWindowOpen(m, now),
    isOrganizer,
    myStatus: mine?.status || null,
    canRespond: Boolean(mine) && !isOrganizer && respondable(m, now),
    canEdit: isOrganizer && m.status === 'scheduled',
  });
});

export const previewParticipants = asyncHandler(async (req, res) => {
  const { participants, people } = await expand(req.body, req.user._id);
  const byId = new Map(people.users.map((u) => [idOf(u._id), u]));
  const depts = new Map(people.departments.map((d) => [idOf(d._id), d]));
  res.json({
    count: participants.length,
    items: participants.slice(0, 200).map((p) => {
      const u = byId.get(idOf(p.user));
      return { _id: u._id, fullName: u.fullName, department: depts.get(idOf(u.department))?.name || '' };
    }),
  });
});

// ------------------------------------------------------------------ create
export const createMeeting = asyncHandler(async (req, res) => {
  if (!canOrganize(req.user)) throw forbidden('Only department heads and managers can organize meetings');
  const b = req.body;
  if (b.startsAt < new Date(Date.now() - 5 * 60000)) throw bad('The start time is in the past');
  const { participants, people } = await expand(b, req.user._id);
  if (participants.length < 2) throw bad('Invite at least one department or person');

  const end = calcEnd(b.startsAt, b.durationMinutes);
  const meeting = await Meeting.create({
    title: b.title, agenda: b.agenda, organizer: req.user._id,
    hostDepartment: b.hostDepartmentId || req.user.department || null,
    startsAt: b.startsAt, durationMinutes: b.durationMinutes, endsAt: end,
    channel: b.channel, joinUrl: b.joinUrl, passcode: b.passcode, meetingNumber: b.meetingNumber, location: b.location,
    invites: b.invites.map((i) => ({ department: i.departmentId, scope: i.scope, includeSubunits: i.includeSubunits })),
    invitedUsers: b.invitedUserIds, participants,
  });
  const invitees = participants.filter((p) => idOf(p.user) !== idOf(req.user._id)).map((p) => p.user);
  await notify(invitees, {
    type: 'meeting_invited',
    meta: { title: meeting.title, startsAt: when(meeting.startsAt), organizer: req.user.fullName },
    ...meetingLink(meeting),
  });
  await audit(req.user._id, 'meeting.create', 'Meeting', meeting._id, { title: meeting.title, participants: participants.length });
  const conflicts = await findConflicts(participants.map((p) => p.user), b.startsAt, end, meeting._id, people);
  res.status(201).json({ meeting: { _id: meeting._id }, conflicts });
});

// ------------------------------------------------------------------ update
export const updateMeeting = asyncHandler(async (req, res) => {
  const { m, isOrganizer } = await loadMeeting(req);
  if (!isOrganizer) throw forbidden('Only the organizer can change the meeting');
  if (m.status !== 'scheduled') throw conflict('A cancelled or finished meeting cannot be changed');
  const b = req.body;
  const changes = [];

  if (b.title !== undefined && b.title !== m.title) { m.title = b.title; changes.push('title'); }
  if (b.agenda !== undefined) m.agenda = b.agenda;
  if (b.startsAt !== undefined && +b.startsAt !== +m.startsAt) {
    if (b.startsAt < new Date(Date.now() - 5 * 60000)) throw bad('The start time is in the past');
    m.startsAt = b.startsAt;
    changes.push('time');
  }
  if (b.durationMinutes !== undefined && b.durationMinutes !== m.durationMinutes) { m.durationMinutes = b.durationMinutes; changes.push('time'); }
  for (const k of ['channel', 'joinUrl', 'passcode', 'meetingNumber', 'location']) {
    if (b[k] !== undefined && b[k] !== m[k]) { m[k] = b[k]; changes.push(k === 'location' ? 'place' : 'link'); }
  }
  if (b.hostDepartmentId !== undefined) m.hostDepartment = b.hostDepartmentId || null;
  m.endsAt = calcEnd(m.startsAt, m.durationMinutes);

  let added = [];
  let removed = [];
  let people = null;
  if (b.invites !== undefined || b.invitedUserIds !== undefined) {
    const next = {
      invites: b.invites ?? m.invites.map((i) => ({ departmentId: i.department, scope: i.scope, includeSubunits: i.includeSubunits })),
      invitedUserIds: b.invitedUserIds ?? m.invitedUsers,
    };
    const result = await expand(next, m.organizer, m.participants);
    people = result.people;
    if (result.participants.length < 2) throw bad('Invite at least one department or person');
    const before = new Set(m.participants.map((p) => idOf(p.user)));
    const after = new Set(result.participants.map((p) => idOf(p.user)));
    added = result.participants.filter((p) => !before.has(idOf(p.user))).map((p) => p.user);
    removed = [...before].filter((id) => !after.has(id));
    m.invites = next.invites.map((i) => ({ department: i.departmentId, scope: i.scope, includeSubunits: i.includeSubunits !== false }));
    m.invitedUsers = next.invitedUserIds;
    m.participants = result.participants;
  }
  await m.save();

  const unique = [...new Set(changes)];
  const stay = m.participants
    .filter((p) => idOf(p.user) !== idOf(req.user._id) && !added.some((a) => idOf(a) === idOf(p.user)))
    .map((p) => p.user);
  if (unique.length) {
    await notify(stay, { type: 'meeting_updated', meta: { title: m.title, startsAt: when(m.startsAt), changes: unique }, ...meetingLink(m) });
  }
  if (added.length) {
    await notify(added, { type: 'meeting_invited', meta: { title: m.title, startsAt: when(m.startsAt), organizer: req.user.fullName }, ...meetingLink(m) });
  }
  if (removed.length) await notify(removed, { type: 'meeting_cancelled', meta: { title: m.title, removed: true }, ...meetingLink(m) });
  await audit(req.user._id, 'meeting.update', 'Meeting', m._id, { changes: unique, added: added.length, removed: removed.length });

  const conflicts = unique.includes('time') || added.length
    ? await findConflicts(m.participants.map((p) => p.user), m.startsAt, m.endsAt, m._id, people || (await loadPeople()))
    : [];
  res.json({ ok: true, conflicts });
});

// ------------------------------------------------------------------ answer, cancel, finish
export const respond = asyncHandler(async (req, res) => {
  const { m, isOrganizer } = await loadMeeting(req);
  if (isOrganizer) throw bad('The organizer is already attending');
  if (!respondable(m)) throw conflict('This meeting is over or cancelled');
  const p = m.participants.find((x) => idOf(x.user) === idOf(req.user._id));
  p.status = req.body.status;
  p.respondedAt = new Date();
  await m.save();
  if (req.body.status === 'declined') {
    await notify([m.organizer], { type: 'meeting_response', meta: { title: m.title, name: req.user.fullName, status: 'declined' }, ...meetingLink(m) });
  }
  res.json({ ok: true, status: p.status });
});

export const cancelMeeting = asyncHandler(async (req, res) => {
  const { m, isOrganizer } = await loadMeeting(req);
  if (!isOrganizer) throw forbidden('Only the organizer can cancel the meeting');
  if (m.status !== 'scheduled') throw conflict('This meeting is already finished or cancelled');
  m.status = 'cancelled';
  m.cancelReason = req.body.reason;
  await m.save();
  await notify(m.participants.filter((p) => idOf(p.user) !== idOf(req.user._id)).map((p) => p.user), {
    type: 'meeting_cancelled', meta: { title: m.title, startsAt: when(m.startsAt), reason: req.body.reason }, ...meetingLink(m),
  });
  await audit(req.user._id, 'meeting.cancel', 'Meeting', m._id, { reason: req.body.reason });
  res.json({ ok: true });
});

export const completeMeeting = asyncHandler(async (req, res) => {
  const { m, isOrganizer } = await loadMeeting(req);
  if (!isOrganizer) throw forbidden('Only the organizer can finish the meeting');
  if (m.status !== 'scheduled') throw conflict('This meeting is already finished or cancelled');
  m.status = 'completed';
  await m.save();
  await audit(req.user._id, 'meeting.complete', 'Meeting', m._id, {});
  res.json({ ok: true });
});

// minutes (ቃለ ጉባኤ), action items and who attended
export const saveMinutes = asyncHandler(async (req, res) => {
  const { m, isOrganizer } = await loadMeeting(req);
  if (!isOrganizer) throw forbidden('Only the organizer can write the minutes');
  if (m.status === 'cancelled') throw conflict('A cancelled meeting has no minutes');
  const first = !m.minutes && req.body.minutes.length > 0;
  m.minutes = req.body.minutes;
  m.minutesUpdatedAt = new Date();
  m.actions = req.body.actions.map((a) => ({ title: a.title, owner: a.ownerId || null, dueDate: a.dueDate || null, done: a.done }));
  const attended = new Set(req.body.attendedUserIds.map(String));
  m.participants.forEach((p) => { p.attended = attended.has(idOf(p.user)); });
  await m.save();
  if (first) {
    await notify(m.participants.filter((p) => idOf(p.user) !== idOf(req.user._id)).map((p) => p.user), {
      type: 'meeting_minutes', meta: { title: m.title }, ...meetingLink(m),
    });
  }
  await audit(req.user._id, 'meeting.minutes', 'Meeting', m._id, { actions: m.actions.length });
  res.json({ ok: true });
});
