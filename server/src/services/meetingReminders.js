import Meeting from '../models/Meeting.js';
import { notify } from './notify.js';
import { idStr } from './workflow.js';

const MINUTE = 60000;

// Tells everybody who has not declined that the meeting starts within 30 minutes (once per person and meeting).
export async function runMeetingReminders(now = new Date()) {
  const soon = new Date(now.getTime() + 30 * MINUTE);
  const meetings = await Meeting.find({ status: 'scheduled', startsAt: { $gte: now, $lte: soon } })
    .select('title startsAt participants.user participants.status')
    .lean();
  let sent = 0;
  for (const m of meetings) {
    const ids = m.participants.filter((p) => p.status !== 'declined').map((p) => idStr(p.user));
    await notify(ids, {
      type: 'meeting_reminder',
      meta: { title: m.title, startsAt: m.startsAt },
      meeting: m._id,
      dedupeKey: `mtg:${m._id}`,
    });
    sent += ids.length;
  }
  return sent;
}

export function startMeetingReminders() {
  const run = () => runMeetingReminders().catch((e) => console.error('meeting reminders failed:', e.message));
  setTimeout(run, 20_000).unref?.();
  setInterval(run, 5 * MINUTE).unref?.();
}
