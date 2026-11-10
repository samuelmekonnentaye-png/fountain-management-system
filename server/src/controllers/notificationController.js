import Notification from '../models/Notification.js';
import { asyncHandler, isObjectId, notFound, paginate } from '../utils/http.js';
import { runReminders } from '../services/reminders.js';

export const listNotifications = asyncHandler(async (req, res) => {
  const { page, limit, skip } = paginate(req.query);
  const filter = { user: req.user._id };
  if (req.query.unread === 'true') filter.isRead = false;
  const [items, total, unread] = await Promise.all([
    Notification.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
    Notification.countDocuments(filter),
    Notification.countDocuments({ user: req.user._id, isRead: false }),
  ]);
  res.json({ items, total, unread, page, pages: Math.max(1, Math.ceil(total / limit)) });
});

export const markRead = asyncHandler(async (req, res) => {
  if (!isObjectId(req.params.id)) throw notFound('Notification not found');
  const n = await Notification.findOneAndUpdate({ _id: req.params.id, user: req.user._id }, { isRead: true }, { new: true });
  if (!n) throw notFound('Notification not found');
  res.json({ ok: true });
});

export const markAllRead = asyncHandler(async (req, res) => {
  await Notification.updateMany({ user: req.user._id, isRead: false }, { isRead: true });
  res.json({ ok: true });
});

// Admin: run the reminder job now (it also runs automatically every 6 hours).
export const runRemindersNow = asyncHandler(async (_req, res) => {
  res.json({ counts: await runReminders() });
});
