import mongoose from 'mongoose';

export const NOTIFICATION_TYPES = [
  'report_received',
  'report_approved',
  'report_returned',
  'report_rejected',
  'report_forwarded',
  'deadline_near',
  'reminder',
  'registration_pending',
  'meeting_invited',
  'meeting_updated',
  'meeting_cancelled',
  'meeting_reminder',
  'meeting_minutes',
  'meeting_response',
];

const notificationSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    type: { type: String, enum: NOTIFICATION_TYPES, required: true },
    meta: { type: mongoose.Schema.Types.Mixed, default: {} }, // rendered/translated by the client
    report: { type: mongoose.Schema.Types.ObjectId, ref: 'Report' },
    plan: { type: mongoose.Schema.Types.ObjectId, ref: 'WorkPlan' },
    meeting: { type: mongoose.Schema.Types.ObjectId, ref: 'Meeting' },
    isRead: { type: Boolean, default: false },
    dedupeKey: { type: String },
  },
  { timestamps: true }
);

notificationSchema.index({ user: 1, createdAt: -1 });
notificationSchema.index(
  { user: 1, dedupeKey: 1 },
  { unique: true, partialFilterExpression: { dedupeKey: { $type: 'string' } } }
);

export default mongoose.model('Notification', notificationSchema);
