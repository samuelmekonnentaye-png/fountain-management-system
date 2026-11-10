import { Router } from 'express';
import { protect, authorize } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { authLimiter } from '../middleware/rateLimit.js';
import { ROLES, TEAM_ROLES } from '../config/roles.js';
import * as v from '../validators/schemas.js';
import * as auth from '../controllers/authController.js';
import * as users from '../controllers/userController.js';
import * as depts from '../controllers/departmentController.js';
import * as periods from '../controllers/periodController.js';
import * as plans from '../controllers/planController.js';
import * as reports from '../controllers/reportController.js';
import * as notifs from '../controllers/notificationController.js';
import * as dash from '../controllers/dashboardController.js';
import * as exp from '../controllers/exportController.js';
import * as audit from '../controllers/auditController.js';
import * as adminCtl from '../controllers/adminController.js';
import * as positions from '../controllers/positionController.js';
import * as meetings from '../controllers/meetingController.js';

const router = Router();
const admin = [protect, authorize(ROLES.ADMIN)];
const team = [protect, authorize(...TEAM_ROLES)];
const periodManagers = [protect, authorize(ROLES.ADMIN, ROLES.GM)];

router.get('/health', (_req, res) => res.json({ ok: true, time: new Date().toISOString() }));

// auth
router.post('/auth/register', authLimiter, validate(v.registerBody), auth.register);
router.post('/auth/login', authLimiter, validate(v.loginBody), auth.login);
router.get('/auth/me', protect, auth.me);
router.patch('/auth/me', protect, validate(v.updateMeBody), auth.updateMe);
router.post('/auth/change-password', protect, authLimiter, validate(v.changePasswordBody), auth.changePassword);

// users
router.get('/users/search', protect, users.searchUsers);
router.get('/users/me/approval-chain', protect, users.myApprovalChain);
router.get('/users/pending-count', ...admin, users.pendingCount);
router.get('/users/registrations', ...admin, users.listRegistrations);
router.post('/users/:id/approve', ...admin, validate(v.approveUserBody), users.approveUser);
router.post('/users/:id/reject', ...admin, validate(v.rejectUserBody), users.rejectUser);
router.get('/users', ...admin, users.listUsers);
router.post('/users', ...admin, validate(v.createUserBody), users.createUser);
router.patch('/users/:id', ...admin, validate(v.updateUserBody), users.updateUser);
router.post('/users/:id/reset-password', ...admin, validate(v.resetPasswordBody), users.resetPassword);

// departments (list is public so the registration form can show it)
router.get('/departments', depts.listDepartments);
router.post('/departments', ...admin, validate(v.createDepartmentBody), depts.createDepartment);
router.patch('/departments/:id', ...admin, validate(v.updateDepartmentBody), depts.updateDepartment);
router.delete('/departments/:id', ...admin, depts.deleteDepartment);

// organisation chart (everyone reads; System Admin edits)
router.get('/positions/public', positions.listPublic);
router.get('/positions', protect, positions.listPositions);
router.get('/positions/check', ...admin, positions.checkSuperiors);
router.post('/positions/import-company-structure', ...admin, positions.importCompany);
router.post('/positions', ...admin, validate(v.createPositionBody), positions.createPosition);
router.patch('/positions/:id', ...admin, validate(v.updatePositionBody), positions.updatePosition);
router.delete('/positions/:id', ...admin, positions.deletePosition);

// reporting periods (everyone reads; System Admin and General Manager manage)
router.get('/periods', protect, periods.listPeriods);
router.post('/periods', ...periodManagers, validate(v.createPeriodBody), periods.createPeriod);
router.patch('/periods/:id', ...periodManagers, validate(v.updatePeriodBody), periods.updatePeriod);
router.delete('/periods/:id', ...periodManagers, periods.deletePeriod);

// work plans
router.get('/plans', protect, plans.overview);
router.post('/plans', protect, validate(v.createPlanBody), plans.createPlan);
router.get('/plans/:id', protect, plans.getPlan);
router.put('/plans/:id', protect, validate(v.updatePlanBody), plans.updatePlan);
router.post('/plans/:id/reopen', protect, validate(v.reopenPlanBody), plans.reopenPlan);
router.delete('/plans/:id', protect, plans.deletePlan);

// reports
router.post('/reports', protect, validate(v.sendReportBody), reports.sendReport);
router.get('/reports/inbox', protect, reports.inbox);
router.get('/reports/sent', protect, reports.sent);
router.get('/reports/stats', protect, reports.stats);
router.get('/reports/:id', protect, reports.getReport);
router.post('/reports/:id/review', protect, validate(v.reviewReportBody), reports.reviewReport);
router.post('/reports/:id/forward', protect, validate(v.forwardReportBody), reports.forwardReport);

// meetings (people invited, department to department)
router.get('/meetings', protect, meetings.listMeetings);
router.get('/meetings/stats', protect, meetings.meetingStats);
router.post('/meetings/preview', protect, validate(v.previewMeetingBody), meetings.previewParticipants);
router.post('/meetings', protect, validate(v.createMeetingBody), meetings.createMeeting);
router.get('/meetings/:id', protect, meetings.getMeeting);
router.patch('/meetings/:id', protect, validate(v.updateMeetingBody), meetings.updateMeeting);
router.post('/meetings/:id/respond', protect, validate(v.respondMeetingBody), meetings.respond);
router.post('/meetings/:id/cancel', protect, validate(v.cancelMeetingBody), meetings.cancelMeeting);
router.post('/meetings/:id/complete', protect, meetings.completeMeeting);
router.put('/meetings/:id/minutes', protect, validate(v.minutesBody), meetings.saveMinutes);

// notifications
router.get('/notifications', protect, notifs.listNotifications);
router.post('/notifications/read-all', protect, notifs.markAllRead);
router.post('/notifications/run-reminders', ...admin, notifs.runRemindersNow);
router.patch('/notifications/:id/read', protect, notifs.markRead);

// dashboards
router.get('/dashboard/me', protect, dash.myDashboard);
router.get('/dashboard/team', ...team, dash.teamDashboard);

// exports
router.get('/exports/my-plans', protect, exp.exportMyPlans);
router.get('/exports/performance', ...team, exp.exportPerformance);
router.get('/exports/performance.csv', ...team, exp.exportPerformanceCsv);
router.get('/exports/report/:id', protect, exp.exportReport);

// audit trail and system overview (System Admin)
router.get('/audit', ...admin, audit.listAudit);
router.get('/admin/overview', ...admin, adminCtl.overview);

export default router;
