import { fmtDate, fmtLocalDate, fmtTime } from './format.js';
import { ROLE_LABEL } from './roles.js';

export function notifText(n, t, lang) {
  const m = n.meta || {};
  const period = m.period || '';
  const kind = m.kind === 'plan' ? t('work plan') : t('monthly evaluation');
  switch (n.type) {
    case 'report_received':
      if (m.step && m.of) {
        return t('{sender}\'s {kind} report ({period}) is waiting for your decision (step {step} of {of})', { sender: m.sender, kind, period, step: m.step, of: m.of });
      }
      return m.forwarded
        ? t('{sender} forwarded a {kind} report to you ({period})', { sender: m.sender, kind, period })
        : t('{sender} sent you a {kind} report ({period})', { sender: m.sender, kind, period });
    case 'report_approved':
      return m.partial
        ? t('{reviewer} approved your {kind} report ({period}); it moves to the next approver (step {step} of {of})', { reviewer: m.reviewer, kind, period, step: m.step, of: m.of })
        : t('{reviewer} approved the {kind} report ({period})', { reviewer: m.reviewer, kind, period });
    case 'report_returned':
      return t('{reviewer} returned the {kind} report for correction ({period})', { reviewer: m.reviewer, kind, period });
    case 'report_rejected':
      return t('{reviewer} rejected the {kind} report ({period})', { reviewer: m.reviewer, kind, period });
    case 'report_forwarded':
      return m.to
        ? t('{forwarder} added {to} as the next approver of your {kind} report ({period})', { forwarder: m.forwarder, to: m.to, kind, period })
        : t('{forwarder} forwarded your {kind} report to others ({period})', { forwarder: m.forwarder, kind, period });
    case 'meeting_invited':
      return t('{organizer} invited you to the meeting "{title}" on {date} at {time}', { organizer: m.organizer, title: m.title, date: fmtLocalDate(m.startsAt, lang), time: fmtTime(m.startsAt) });
    case 'meeting_updated':
      return t('The meeting "{title}" was changed. Now: {date} at {time}', { title: m.title, date: fmtLocalDate(m.startsAt, lang), time: fmtTime(m.startsAt) });
    case 'meeting_cancelled':
      return m.removed
        ? t('You are no longer invited to the meeting "{title}"', { title: m.title })
        : t('The meeting "{title}" was cancelled', { title: m.title });
    case 'meeting_reminder':
      return t('Reminder: the meeting "{title}" starts at {time}', { title: m.title, time: fmtTime(m.startsAt) });
    case 'meeting_minutes':
      return t('The minutes of the meeting "{title}" are available', { title: m.title });
    case 'meeting_response':
      return t('{name} declined the meeting "{title}"', { name: m.name, title: m.title });
    case 'registration_pending':
      return t('{name} asked for an account ({role}) and is waiting for your approval', {
        name: m.name, role: (m.requestedRoles || []).map((r) => t(ROLE_LABEL[r] || r)).join(', '),
      });
    case 'deadline_near':
      return t('Deadline approaching: "{title}" is due {date}', { title: m.title, date: fmtDate(m.dueDate, lang) });
    case 'reminder':
      switch (m.reason) {
        case 'pending_review':
          return t('Reminder: {owner}\'s {kind} report ({period}) has been waiting for your decision for days', { owner: m.owner, kind, period });
        case 'returned':
          return t('Reminder: your {kind} report ({period}) was returned and still needs correction', { kind, period });
        case 'period_ending':
          return t('Reminder: the period "{period}" ends on {date} and your evaluation has not been sent', { period, date: fmtDate(m.endDate, lang) });
        case 'overdue':
          return t('Overdue: "{title}" was due on {date}', { title: m.title, date: fmtDate(m.dueDate, lang) });
        default:
          return t('Reminder');
      }
    default:
      return n.type;
  }
}

export const notifLink = (n) =>
  n.type === 'registration_pending' ? '/admin/registrations' : n.meeting ? `/meetings/${n.meeting}` : n.report ? `/reports/${n.report}` : n.plan ? `/plans/${n.plan}` : '/notifications';
