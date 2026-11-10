import bcrypt from 'bcryptjs';
import User from '../models/User.js';
import Department from '../models/Department.js';
import Position from '../models/Position.js';
import { ROLES } from '../config/roles.js';
import { env } from '../config/env.js';
import { asyncHandler, HttpError, bad } from '../utils/http.js';
import { signToken } from '../utils/token.js';
import { audit, notify } from '../services/notify.js';
import { accountBlock } from '../services/accountStatus.js';

// Compared against when the e-mail is unknown, so response time does not reveal which e-mails exist.
const DUMMY_HASH = bcrypt.hashSync('timing-safe-dummy-password', 12);

export const userPopulate = [
  { path: 'department', select: 'name nameAm' },
  { path: 'manager', select: 'fullName' },
  { path: 'position', select: 'name nameAm' },
];

export const register = asyncHandler(async (req, res) => {
  const userCount = await User.countDocuments();
  if (!env.allowRegistration && userCount > 0) throw new HttpError(403, 'Self-registration is disabled');

  const { fullName, email, password, departmentId, positionId, jobTitle, requestedRole } = req.body;
  if (departmentId && !(await Department.exists({ _id: departmentId }))) throw bad('Department not found');
  if (positionId && !(await Position.exists({ _id: positionId }))) throw bad('Position not found');
  if (await User.exists({ email })) {
    throw new HttpError(409, 'An account with this email already exists (it may still be waiting for approval)');
  }

  // The very first account becomes the System Admin so the system can be bootstrapped.
  if (userCount === 0) {
    const user = await User.create({
      fullName, email, password, department: departmentId || undefined, jobTitle: jobTitle || '', roles: [ROLES.ADMIN],
    });
    await audit(user._id, 'user.register', 'User', user._id, { roles: user.roles });
    await user.populate(userPopulate);
    return res.status(201).json({ token: signToken(user._id), user });
  }

  // Everybody else waits for the System Admin. They get the lowest role until it is decided.
  const user = await User.create({
    fullName, email, password,
    department: departmentId || undefined,
    position: positionId || undefined,
    jobTitle: jobTitle || '',
    roles: [ROLES.EMPLOYEE],
    requestedRoles: [requestedRole],
    approvalStatus: 'pending',
    isActive: false,
  });
  await audit(user._id, 'user.register_request', 'User', user._id, { requestedRole });
  const admins = await User.distinct('_id', { roles: ROLES.ADMIN, isActive: true });
  await notify(admins, { type: 'registration_pending', meta: { name: fullName, email, requestedRoles: [requestedRole] } });
  return res.status(202).json({ pending: true });
});

export const login = asyncHandler(async (req, res) => {
  const { email, password } = req.body;
  const user = await User.findOne({ email }).select('+password');
  const ok = await bcrypt.compare(password, user?.password || DUMMY_HASH);
  if (!user || !ok) throw new HttpError(401, 'Incorrect email or password');
  const block = accountBlock(user); // only revealed after the password was correct
  if (block) throw new HttpError(403, block.message, block.code);

  await User.updateOne({ _id: user._id }, { lastLoginAt: new Date() });
  const fresh = await User.findById(user._id).populate(userPopulate);
  res.json({ token: signToken(user._id), user: fresh });
});

export const me = asyncHandler(async (req, res) => {
  await req.user.populate(userPopulate);
  res.json({ user: req.user });
});

export const updateMe = asyncHandler(async (req, res) => {
  const { fullName, jobTitle, preferredLanguage } = req.body;
  if (fullName !== undefined) req.user.fullName = fullName;
  if (jobTitle !== undefined) req.user.jobTitle = jobTitle;
  if (preferredLanguage !== undefined) req.user.preferredLanguage = preferredLanguage;
  await req.user.save();
  await req.user.populate(userPopulate);
  res.json({ user: req.user });
});

export const changePassword = asyncHandler(async (req, res) => {
  const { currentPassword, newPassword } = req.body;
  const user = await User.findById(req.user._id).select('+password');
  if (!(await user.comparePassword(currentPassword))) throw bad('Your current password is incorrect');
  if (currentPassword === newPassword) throw bad('Choose a password different from the current one');

  user.password = newPassword;
  user.mustChangePassword = false;
  user.passwordChangedAt = new Date();
  await user.save();
  await audit(user._id, 'user.change_password', 'User', user._id);
  await user.populate(userPopulate);
  res.json({ token: signToken(user._id), user });
});
