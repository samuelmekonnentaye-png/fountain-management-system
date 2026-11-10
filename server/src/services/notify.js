import Notification from '../models/Notification.js';
import AuditLog from '../models/AuditLog.js';

export async function notify(userIds, { type, meta = {}, report, plan, meeting, dedupeKey }) {
  const ids = [...new Set((userIds || []).map(String))];
  if (!ids.length) return;
  const docs = ids.map((user) => ({ user, type, meta, report, plan, meeting, dedupeKey }));
  try {
    await Notification.insertMany(docs, { ordered: false });
  } catch (e) {
    // Duplicate dedupeKey errors are expected and harmless.
    if (e.code !== 11000 && !e.writeErrors) console.error('notify failed:', e.message);
  }
}

export async function audit(actor, action, entity, entityId, details) {
  try {
    await AuditLog.create({ actor, action, entity, entityId, details });
  } catch (e) {
    console.error('audit failed:', e.message);
  }
}
