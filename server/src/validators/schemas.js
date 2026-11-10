import { z } from 'zod';
import { oid, nullableId, text, dateValue, password, email } from './common.js';
import { ROLE_LIST } from '../config/roles.js';

const TASK_STATUS = ['pending', 'in_progress', 'completed', 'not_completed', 'cancelled'];
const roles = z.array(z.enum(ROLE_LIST)).min(1, 'Choose at least one role').max(6);
const lang = z.enum(['en', 'am']);

// ---------- auth ----------
const REQUESTABLE_ROLES = ROLE_LIST.filter((r) => r !== 'system_admin');
export const registerBody = z.object({
  requestedRole: z.enum(REQUESTABLE_ROLES).default('employee'),
  fullName: text(100).min(3, 'Please enter your full name'),
  email,
  password,
  departmentId: nullableId.optional(),
  positionId: nullableId.optional(),
  jobTitle: text(100).optional(),
});
export const loginBody = z.object({ email: z.string().trim().toLowerCase().max(150), password: z.string().min(1).max(200) });
export const updateMeBody = z.object({
  fullName: text(100).min(3, 'Please enter your full name').optional(),
  jobTitle: text(100).optional(),
  preferredLanguage: lang.optional(),
});
export const changePasswordBody = z.object({ currentPassword: z.string().min(1).max(200), newPassword: password });

// ---------- users ----------
export const createUserBody = z.object({
  fullName: text(100).min(3, 'Please enter the full name'),
  email,
  password,
  employeeId: text(40).optional(),
  roles,
  departmentId: nullableId.optional(),
  positionId: nullableId.optional(),
  managerId: nullableId.optional(),
  jobTitle: text(100).optional(),
});
export const updateUserBody = z.object({
  fullName: text(100).min(3, 'Please enter the full name').optional(),
  employeeId: text(40).optional(),
  roles: roles.optional(),
  departmentId: nullableId.optional(),
  positionId: nullableId.optional(),
  managerId: nullableId.optional(),
  jobTitle: text(100).optional(),
  isActive: z.boolean().optional(),
  preferredLanguage: lang.optional(),
});
export const resetPasswordBody = z.object({ newPassword: password });

// ---------- departments & periods ----------
export const createDepartmentBody = z.object({
  name: text(100).min(2, 'Enter the department name'),
  nameAm: text(100).optional(),
  code: text(20).optional(),
  parentId: nullableId.optional(),
});
export const updateDepartmentBody = createDepartmentBody.partial().extend({ isActive: z.boolean().optional() });

export const createPeriodBody = z
  .object({
    name: text(100).min(2, 'Enter a name for the period'),
    type: z.enum(['weekly', 'monthly', 'custom']),
    startDate: z.coerce.date(),
    endDate: z.coerce.date(),
  })
  .refine((p) => p.endDate >= p.startDate, { message: 'The end date must be on or after the start date', path: ['endDate'] });
export const updatePeriodBody = z.object({
  name: text(100).min(2).optional(),
  status: z.enum(['open', 'closed']).optional(),
});

// ---------- plans ----------
const taskBody = z.object({
  _id: oid.optional(),
  title: text(200).optional(),
  description: text(2000).optional(),
  kpi: text(300).optional(),
  target: z.coerce.number().positive('Target must be greater than 0').optional(),
  unit: text(40).optional(),
  weight: z.coerce.number().min(0, 'Weight must be between 0 and 100').max(100, 'Weight must be between 0 and 100').optional(),
  startDate: dateValue.optional(),
  dueDate: dateValue.optional(),
  status: z.enum(TASK_STATUS).optional(),
  actual: z.coerce.number().min(0, 'Actual result cannot be negative').optional(),
  actualResult: text(2000).optional(),
  shortfallReason: text(2000).optional(),
});
export const createPlanBody = z.object({
  periodId: oid,
  title: text(200).optional(),
  objectives: text(2000).optional(),
  tasks: z.array(taskBody).max(100, 'A plan can have at most 100 tasks').optional(),
});
export const updatePlanBody = z.object({
  title: text(200).optional(),
  objectives: text(2000).optional(),
  tasks: z.array(taskBody).max(100, 'A plan can have at most 100 tasks').optional(),
});
export const reopenPlanBody = z.object({ phase: z.enum(['plan', 'evaluation']) });

// ---------- reports ----------
const idList = z.array(oid).max(30, 'Too many recipients (maximum 30)');
export const sendReportBody = z.object({
  planId: oid,
  kind: z.enum(['plan', 'evaluation']),
  workflow: z.enum(['direct', 'hierarchical']).default('direct'),
  finalApproverId: nullableId.optional(), // hierarchical: stop the chain at this approver
  to: idList.default([]),
  cc: idList.default([]),
  subject: text(200).default(''),
  message: text(3000).default(''),
});
export const reviewReportBody = z.object({
  decision: z.enum(['approved', 'returned', 'rejected']),
  comment: text(2000).default(''),
});
export const forwardReportBody = z.object({
  to: idList.default([]),
  cc: idList.default([]),
  subject: text(200).default(''),
  message: text(3000).default(''),
});

// ---------- registration requests (System Admin) ----------
export const approveUserBody = z.object({
  roles,
  departmentId: nullableId.optional(),
  positionId: nullableId.optional(),
  managerId: nullableId.optional(),
  jobTitle: text(100).optional(),
  employeeId: text(40).optional(),
});
export const rejectUserBody = z.object({ reason: text(500).min(3, 'Write a short reason') });

// ---------- organisation chart ----------
export const createPositionBody = z.object({
  name: text(120).min(2, 'Enter the position name'),
  nameAm: text(120).optional(),
  parentId: nullableId.optional(),
  departmentId: nullableId.optional(),
  approver: z.boolean().default(true),
  chainEnd: z.boolean().default(false),
  seats: z.coerce.number().int().min(1).max(500).default(1),
});
export const updatePositionBody = createPositionBody.partial().extend({ isActive: z.boolean().optional() });
export const sendReportExtra = z.object({ finalApproverId: nullableId.optional() });

// ---------- meetings ----------
const inviteBody = z.object({
  departmentId: oid,
  scope: z.enum(['all', 'heads']).default('all'),
  includeSubunits: z.boolean().default(true),
});
const urlOrEmpty = z
  .string()
  .trim()
  .max(500)
  .refine((v) => v === '' || /^https?:\/\/\S+$/i.test(v), 'Enter a link that starts with http:// or https://');

export const createMeetingBody = z.object({
  title: text(200).min(3, 'Enter the meeting title'),
  agenda: text(4000).default(''),
  startsAt: z.coerce.date(),
  durationMinutes: z.coerce.number().int().min(5, 'At least 5 minutes').max(720, 'At most 12 hours').default(60),
  channel: z.enum(['zoom', 'link', 'in_person']).default('zoom'),
  joinUrl: urlOrEmpty.default(''),
  passcode: text(40).default(''),
  meetingNumber: text(40).default(''),
  location: text(200).default(''),
  hostDepartmentId: nullableId.optional(),
  invites: z.array(inviteBody).max(30).default([]),
  invitedUserIds: z.array(oid).max(200).default([]),
});
export const updateMeetingBody = createMeetingBody.partial();
export const previewMeetingBody = z.object({
  invites: z.array(inviteBody).max(30).default([]),
  invitedUserIds: z.array(oid).max(200).default([]),
});
export const respondMeetingBody = z.object({ status: z.enum(['accepted', 'declined', 'tentative']) });
export const cancelMeetingBody = z.object({ reason: text(500).default('') });
export const minutesBody = z.object({
  minutes: text(20000).default(''),
  actions: z
    .array(z.object({ title: text(300).min(1, 'Write the action'), ownerId: nullableId.optional(), dueDate: dateValue.optional(), done: z.boolean().default(false) }))
    .max(50)
    .default([]),
  attendedUserIds: z.array(oid).max(300).default([]),
});
