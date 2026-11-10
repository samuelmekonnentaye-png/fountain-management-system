import User from '../models/User.js';
import Department from '../models/Department.js';
import { ROLES, ROLE_LIST } from '../config/roles.js';
import {
  asyncHandler, HttpError, bad, cleanStr, escapeRegex, isObjectId, paginate, notFound,
} from '../utils/http.js';
import { audit } from '../services/notify.js';
import { buildChainInfo } from '../services/reportService.js';
import Position from '../models/Position.js';
import { userPopulate } from './authController.js';

// Recipient search bar: any signed-in user can find other active users by name.
export const searchUsers = asyncHandler(async (req, res) => {
  const q = cleanStr(String(req.query.q || ''), 60);
  if (q.length < 1) return res.json({ items: [] });
  const rx = new RegExp(escapeRegex(q), 'i');
  const items = await User.find({
    isActive: true,
    _id: { $ne: req.user._id },
    $or: [{ fullName: rx }, { email: rx }, { employeeId: rx }],
  })
    .select('fullName email roles jobTitle department')
    .populate('department', 'name nameAm')
    .sort({ fullName: 1 })
    .limit(10);
  res.json({ items });
});

// Who will approve my reports if I choose the manager chain?
export const myApprovalChain = asyncHandler(async (req, res) => {
  const info = await buildChainInfo(req.user._id);
  const users = await User.find({ _id: { $in: info.ids } }).select('fullName jobTitle roles position').populate('position', 'name nameAm');
  const byId = new Map(users.map((u) => [String(u._id), u]));
  res.json({
    items: info.ids.map((id) => byId.get(id)).filter(Boolean),
    problem: info.stop === 'ambiguous' ? 'ambiguous' : info.ids.length === 0 ? 'none' : null,
    positionName: info.positionName,
  });
});

export const listUsers = asyncHandler(async (req, res) => {
  const { page, limit, skip } = paginate(req.query);
  const filter = { approvalStatus: { $nin: ['pending', 'rejected'] } };
  const q = cleanStr(String(req.query.q || ''), 60);
  if (q) {
    const rx = new RegExp(escapeRegex(q), 'i');
    filter.$or = [{ fullName: rx }, { email: rx }, { employeeId: rx }];
  }
  if (req.query.role && ROLE_LIST.includes(req.query.role)) filter.roles = req.query.role;
  if (req.query.department && isObjectId(req.query.department)) filter.department = req.query.department;
  if (req.query.active === 'true') filter.isActive = true;
  if (req.query.active === 'false') filter.isActive = false;

  const [items, total] = await Promise.all([
    User.find(filter).populate(userPopulate).sort({ fullName: 1 }).skip(skip).limit(limit),
    User.countDocuments(filter),
  ]);
  res.json({ items, total, page, pages: Math.max(1, Math.ceil(total / limit)) });
});

async function checkDepartment(id) {
  if (id && !(await Department.exists({ _id: id }))) throw bad('Department not found');
}
async function checkPosition(id) {
  if (id && !(await Position.exists({ _id: id }))) throw bad('Position not found');
}
async function positionName(id) {
  return id ? (await Position.findById(id).select('name'))?.name || '' : '';
}
async function checkManager(id, selfId) {
  if (!id) return;
  if (selfId && String(id) === String(selfId)) throw bad('A person cannot be their own manager');
  const manager = await User.findById(id).select('isActive');
  if (!manager || !manager.isActive) throw bad('Manager not found or not active');
  if (selfId) {
    // walk up from the new manager: reaching this user would create a loop
    const all = await User.find({}).select('manager').lean();
    const map = new Map(all.map((u) => [String(u._id), u.manager ? String(u.manager) : null]));
    let cur = String(id);
    const seen = new Set();
    while (cur && !seen.has(cur)) {
      if (cur === String(selfId)) throw bad('This manager is below the user in the hierarchy (it would create a loop)');
      seen.add(cur);
      cur = map.get(cur);
    }
  }
}

export const createUser = asyncHandler(async (req, res) => {
  const b = req.body;
  if (await User.exists({ email: b.email })) throw new HttpError(409, 'An account with this email already exists');
  await checkDepartment(b.departmentId);
  await checkPosition(b.positionId);
  await checkManager(b.managerId);

  const user = await User.create({
    fullName: b.fullName,
    email: b.email,
    password: b.password,
    employeeId: b.employeeId,
    roles: [...new Set(b.roles)],
    department: b.departmentId || undefined,
    position: b.positionId || undefined,
    manager: b.managerId || undefined,
    jobTitle: b.jobTitle || (await positionName(b.positionId)),
    mustChangePassword: true,
  });
  await audit(req.user._id, 'user.create', 'User', user._id, { email: b.email, roles: user.roles });
  await user.populate(userPopulate);
  res.status(201).json({ user });
});

export const updateUser = asyncHandler(async (req, res) => {
  if (!isObjectId(req.params.id)) throw notFound('User not found');
  const user = await User.findById(req.params.id);
  if (!user) throw notFound('User not found');
  const b = req.body;

  const changes = {};
  if (b.fullName !== undefined) changes.fullName = b.fullName;
  if (b.jobTitle !== undefined) changes.jobTitle = b.jobTitle;
  if (b.employeeId !== undefined) changes.employeeId = b.employeeId;
  if (b.preferredLanguage !== undefined) changes.preferredLanguage = b.preferredLanguage;
  if (b.roles !== undefined) changes.roles = [...new Set(b.roles)];
  if (b.isActive !== undefined) changes.isActive = b.isActive;
  if (b.departmentId !== undefined) {
    await checkDepartment(b.departmentId);
    changes.department = b.departmentId || null;
  }
  if (b.positionId !== undefined) {
    await checkPosition(b.positionId);
    changes.position = b.positionId || null;
    if (b.positionId && b.jobTitle === undefined && !user.jobTitle) changes.jobTitle = await positionName(b.positionId);
  }
  if (b.managerId !== undefined) {
    await checkManager(b.managerId, user._id);
    changes.manager = b.managerId || null;
  }

  // Never lock the organisation out of administration.
  const losingAdmin =
    user.roles.includes(ROLES.ADMIN) &&
    ((changes.roles && !changes.roles.includes(ROLES.ADMIN)) || changes.isActive === false);
  if (losingAdmin) {
    const otherAdmins = await User.countDocuments({ roles: ROLES.ADMIN, isActive: true, _id: { $ne: user._id } });
    if (otherAdmins === 0) throw bad('There must be at least one active System Admin');
  }
  if (String(user._id) === String(req.user._id) && changes.isActive === false) {
    throw bad('You cannot deactivate your own account');
  }

  user.set(changes);
  await user.save();
  await audit(req.user._id, 'user.update', 'User', user._id, changes);
  await user.populate(userPopulate);
  res.json({ user });
});

export const resetPassword = asyncHandler(async (req, res) => {
  if (!isObjectId(req.params.id)) throw notFound('User not found');
  const user = await User.findById(req.params.id).select('+password');
  if (!user) throw notFound('User not found');
  user.password = req.body.newPassword;
  user.mustChangePassword = true;
  user.passwordChangedAt = new Date();
  await user.save();
  await audit(req.user._id, 'user.reset_password', 'User', user._id);
  res.json({ ok: true });
});

// ---------------------------------------------------------------- registration requests
export const listRegistrations = asyncHandler(async (req, res) => {
  const status = req.query.status === 'rejected' ? 'rejected' : 'pending';
  const items = await User.find({ approvalStatus: status })
    .populate(userPopulate)
    .populate('decidedBy', 'fullName')
    .sort(status === 'pending' ? { createdAt: 1 } : { decidedAt: -1 })
    .limit(200);
  res.json({ items });
});

export const pendingCount = asyncHandler(async (_req, res) => {
  res.json({ count: await User.countDocuments({ approvalStatus: 'pending' }) });
});

export const approveUser = asyncHandler(async (req, res) => {
  if (!isObjectId(req.params.id)) throw notFound('User not found');
  const user = await User.findById(req.params.id);
  if (!user) throw notFound('User not found');
  if (user.approvalStatus === 'approved') throw new HttpError(409, 'This account is already approved');
  const b = req.body;
  await checkDepartment(b.departmentId);
  await checkPosition(b.positionId);
  await checkManager(b.managerId, user._id);

  user.roles = [...new Set(b.roles)];
  if (b.positionId !== undefined) {
    user.position = b.positionId || undefined;
    if (b.positionId && !b.jobTitle && !user.jobTitle) user.jobTitle = await positionName(b.positionId);
  }
  if (b.departmentId !== undefined) user.department = b.departmentId || undefined;
  if (b.managerId !== undefined) user.manager = b.managerId || undefined;
  if (b.jobTitle !== undefined) user.jobTitle = b.jobTitle;
  if (b.employeeId) user.employeeId = b.employeeId;
  user.approvalStatus = 'approved';
  user.isActive = true;
  user.rejectionReason = '';
  user.decidedAt = new Date();
  user.decidedBy = req.user._id;
  await user.save();
  await audit(req.user._id, 'user.approve', 'User', user._id, { roles: user.roles, requested: user.requestedRoles });
  await user.populate(userPopulate);
  res.json({ user });
});

export const rejectUser = asyncHandler(async (req, res) => {
  if (!isObjectId(req.params.id)) throw notFound('User not found');
  const user = await User.findById(req.params.id);
  if (!user) throw notFound('User not found');
  if (user.approvalStatus === 'approved') throw new HttpError(409, 'This account is already approved; deactivate it instead');
  user.approvalStatus = 'rejected';
  user.isActive = false;
  user.rejectionReason = req.body.reason;
  user.decidedAt = new Date();
  user.decidedBy = req.user._id;
  await user.save();
  await audit(req.user._id, 'user.reject', 'User', user._id, { reason: req.body.reason });
  res.json({ ok: true });
});
