import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { CalendarPlus, Check, Copy, MapPin, Pencil, Plus, Save, Trash2, Video, X } from 'lucide-react';
import api, { errMsg } from '../api/client.js';
import { useI18n } from '../context/I18nContext.jsx';
import { useToast } from '../context/ToastContext.jsx';
import { useFetch } from '../hooks/useFetch.js';
import { deptName, fmtLocalDate, timeRange, toDateInput } from '../utils/format.js';
import { Badge, ErrorBox, Modal, PageHead, PageLoader } from '../components/ui.jsx';
import MeetingForm from '../components/MeetingForm.jsx';
import { CHANNEL_LABEL, RsvpBadge } from './Meetings.jsx';

function downloadIcs(m, t) {
  const stamp = (d) => new Date(d).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  const esc = (s) => String(s || '').replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/,/g, '\\,').replace(/;/g, '\\;');
  const where = m.channel === 'in_person' ? m.location : m.joinUrl;
  const lines = [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//FOUNTAIN INTERNATIONAL TRADING PLC//Work Plan//EN', 'BEGIN:VEVENT',
    `UID:${m._id}@fountain`, `DTSTAMP:${stamp(new Date())}`, `DTSTART:${stamp(m.startsAt)}`, `DTEND:${stamp(m.endsAt)}`,
    `SUMMARY:${esc(m.title)}`, `DESCRIPTION:${esc([m.agenda, m.joinUrl && `${t('Link')}: ${m.joinUrl}`, m.passcode && `${t('Passcode')}: ${m.passcode}`].filter(Boolean).join('\n'))}`,
    `LOCATION:${esc(where)}`, 'END:VEVENT', 'END:VCALENDAR',
  ];
  const url = URL.createObjectURL(new Blob([lines.join('\r\n')], { type: 'text/calendar' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = 'meeting.ics';
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export default function MeetingView() {
  const { id } = useParams();
  const { t, lang } = useI18n();
  const toast = useToast();
  const { data, loading, error, reload } = useFetch(() => api.get(`/meetings/${id}`).then((r) => r.data), [id]);

  const [editing, setEditing] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [minutes, setMinutes] = useState('');
  const [actions, setActions] = useState([]);
  const [attended, setAttended] = useState(new Set());

  useEffect(() => {
    if (!data) return;
    const m = data.meeting;
    setMinutes(m.minutes || '');
    setActions((m.actions || []).map((a) => ({ title: a.title, ownerId: a.owner?._id || '', dueDate: toDateInput(a.dueDate), done: a.done })));
    setAttended(new Set(m.participants.filter((p) => p.attended).map((p) => p.user._id)));
  }, [data]);

  const groups = useMemo(() => {
    if (!data) return [];
    const map = new Map();
    data.meeting.participants.forEach((p) => {
      const key = p.source === 'organizer' ? 'organizer' : p.department?._id || 'people';
      const label = key === 'organizer' ? t('Organizer') : key === 'people' ? t('Invited people') : deptName(p.department, lang);
      if (!map.has(key)) map.set(key, { key, label, items: [] });
      map.get(key).items.push(p);
    });
    return [...map.values()];
  }, [data, lang, t]);

  if (loading && !data) return <div className="page"><PageLoader /></div>;
  if (error) return <div className="page"><ErrorBox error={error} onRetry={reload} /></div>;

  const { meeting: m, phase, joinOpen, isOrganizer, myStatus, canRespond, canEdit } = data;
  const call = async (fn, okMsg) => {
    setBusy(true);
    try {
      await fn();
      if (okMsg) toast.success(okMsg);
      await reload();
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setBusy(false);
    }
  };
  const respond = (status) => call(() => api.post(`/meetings/${id}/respond`, { status }), t('Your answer was saved'));
  const complete = () => call(() => api.post(`/meetings/${id}/complete`), t('The meeting is marked as finished'));
  const cancel = async () => {
    await call(() => api.post(`/meetings/${id}/cancel`, { reason }), t('The meeting was cancelled'));
    setCancelling(false);
  };
  const saveMinutes = () =>
    call(
      () => api.put(`/meetings/${id}/minutes`, {
        minutes,
        actions: actions.filter((a) => a.title.trim()).map((a) => ({ title: a.title, ownerId: a.ownerId || null, dueDate: a.dueDate || null, done: a.done })),
        attendedUserIds: [...attended],
      }),
      t('Minutes saved')
    );
  const copy = async (text) => {
    try {
      await navigator.clipboard.writeText(text);
      toast.success(t('Copied'));
    } catch {
      toast.error(t('Could not copy'));
    }
  };
  const patchAction = (i, patch) => setActions((xs) => xs.map((x, idx) => (idx === i ? { ...x, ...patch } : x)));
  const toggleAttended = (uid) =>
    setAttended((s) => {
      const n = new Set(s);
      if (n.has(uid)) n.delete(uid); else n.add(uid);
      return n;
    });

  const Icon = m.channel === 'in_person' ? MapPin : Video;
  const finished = m.status === 'completed' || phase === 'ended';
  const showMinutes = isOrganizer ? m.status !== 'cancelled' : Boolean(m.minutes) || (m.actions || []).length > 0;

  return (
    <div className="page">
      <PageHead
        title={m.title}
        subtitle={`${fmtLocalDate(m.startsAt, lang)} · ${timeRange(m.startsAt, m.endsAt)}`}
        actions={
          <>
            {phase === 'live' && <Badge tone="good">{t('Live now')}</Badge>}
            {m.status === 'cancelled' && <Badge tone="bad">{t('Cancelled')}</Badge>}
            {m.status === 'completed' && <Badge>{t('Finished')}</Badge>}
            <button className="btn btn-ghost btn-sm" onClick={() => downloadIcs(m, t)}><CalendarPlus size={15} /> {t('Add to calendar')}</button>
            <Link to="/meetings" className="btn btn-ghost btn-sm">{t('All meetings')}</Link>
          </>
        }
      />

      {m.status === 'cancelled' && (
        <div className="alert alert-bad">
          <div><strong>{t('This meeting was cancelled.')}</strong>{m.cancelReason && <div>{m.cancelReason}</div>}</div>
        </div>
      )}

      <div className="grid hero">
        <section className="glass card stack">
          <div className="row" style={{ gap: 10 }}>
            <Icon size={20} color="#0b4fd6" />
            <h2>{t(CHANNEL_LABEL[m.channel])}</h2>
          </div>
          {m.channel === 'in_person' ? (
            <p><strong>{t('Place')}:</strong> {m.location || '–'}</p>
          ) : m.joinUrl ? (
            <div className="stack-sm">
              <div className="row wrap">
                <a className={`btn ${joinOpen ? 'btn-primary' : 'btn-ghost'}`} href={m.joinUrl} target="_blank" rel="noopener noreferrer">
                  <Video size={16} /> {t('Join the meeting')}
                </a>
                <button className="btn btn-ghost btn-sm" onClick={() => copy(m.joinUrl)}><Copy size={14} /> {t('Copy link')}</button>
              </div>
              {!joinOpen && m.status === 'scheduled' && phase === 'upcoming' && <span className="muted small">{t('The link is ready; the meeting starts at the time above.')}</span>}
              {(m.meetingNumber || m.passcode) && (
                <p className="small">
                  {m.meetingNumber && <>{t('Meeting ID')}: <strong>{m.meetingNumber}</strong> </>}
                  {m.passcode && <>· {t('Passcode')}: <strong>{m.passcode}</strong></>}
                </p>
              )}
            </div>
          ) : (
            <p className="muted">{t('The link has not been added yet.')}</p>
          )}
          <div>
            <h3 style={{ marginBottom: 4 }}>{t('Agenda')}</h3>
            <p style={{ whiteSpace: 'pre-wrap' }}>{m.agenda || <span className="muted">–</span>}</p>
          </div>
          <dl className="kv">
            <dt>{t('Organizer')}</dt><dd>{m.organizer.fullName}</dd>
            <dt>{t('Host department')}</dt><dd>{deptName(m.hostDepartment, lang) || '–'}</dd>
            <dt>{t('Duration')}</dt><dd>{t('{n} minutes', { n: m.durationMinutes })}</dd>
          </dl>
        </section>

        <section className="glass card stack">
          {canRespond && (
            <div className="stack-sm">
              <h2>{t('Will you attend?')}</h2>
              <div className="row wrap">
                <button className={`btn btn-sm ${myStatus === 'accepted' ? 'btn-good' : 'btn-ghost'}`} disabled={busy} onClick={() => respond('accepted')}><Check size={14} /> {t('Accept')}</button>
                <button className={`btn btn-sm ${myStatus === 'tentative' ? 'btn-primary' : 'btn-ghost'}`} disabled={busy} onClick={() => respond('tentative')}>{t('Maybe')}</button>
                <button className={`btn btn-sm ${myStatus === 'declined' ? 'btn-danger' : 'btn-ghost'}`} disabled={busy} onClick={() => respond('declined')}><X size={14} /> {t('Decline')}</button>
              </div>
              <RsvpBadge status={myStatus} />
            </div>
          )}
          {isOrganizer && (
            <div className="stack-sm">
              <h2>{t('Organizer')}</h2>
              <div className="row wrap">
                {canEdit && <button className="btn btn-ghost btn-sm" onClick={() => setEditing(true)}><Pencil size={14} /> {t('Edit')}</button>}
                {canEdit && <button className="btn btn-ghost btn-sm" disabled={busy} onClick={complete}><Check size={14} /> {t('Mark as finished')}</button>}
                {canEdit && <button className="btn btn-danger btn-sm" onClick={() => { setReason(''); setCancelling(true); }}><X size={14} /> {t('Cancel meeting')}</button>}
              </div>
            </div>
          )}
          <div className="stack-sm">
            <h2>{t('Participants')} ({m.participants.length})</h2>
            <div className="muted small">
              {t('{a} accepted', { a: m.participants.filter((p) => p.status === 'accepted').length })} ·{' '}
              {t('{a} declined', { a: m.participants.filter((p) => p.status === 'declined').length })} ·{' '}
              {t('{a} waiting', { a: m.participants.filter((p) => p.status === 'invited').length })}
            </div>
          </div>
        </section>
      </div>

      <section className="glass card stack">
        {groups.map((g) => (
          <div key={g.key} className="stack-sm">
            <h3>{g.label} <span className="muted small">({g.items.length})</span></h3>
            <div className="list">
              {g.items.map((p) => (
                <div key={p.user._id} className="list-item">
                  <div className="grow">
                    <strong>{p.user.fullName}</strong>
                    {p.user.jobTitle && <span className="muted small"> · {p.user.jobTitle}</span>}
                  </div>
                  {finished && p.attended && <Badge tone="good">{t('Attended')}</Badge>}
                  <RsvpBadge status={p.source === 'organizer' ? 'accepted' : p.status} />
                </div>
              ))}
            </div>
          </div>
        ))}
      </section>

      {showMinutes && (
        <section className="glass card stack">
          <h2>{t('Minutes and decisions')}</h2>
          {isOrganizer ? (
            <>
              <div className="field">
                <label>{t('Minutes')}</label>
                <textarea className="textarea" style={{ minHeight: 120 }} value={minutes} maxLength={20000} onChange={(e) => setMinutes(e.target.value)}
                  placeholder={t('What was discussed and decided?')} />
              </div>
              <div className="stack-sm">
                <span className="label">{t('Actions to follow up')}</span>
                {actions.map((a, i) => (
                  <div key={i} className="row wrap" style={{ gap: 8 }}>
                    <input className="input grow" style={{ minWidth: 200 }} value={a.title} placeholder={t('Action')} maxLength={300} onChange={(e) => patchAction(i, { title: e.target.value })} />
                    <select className="select" style={{ width: 'auto' }} value={a.ownerId} onChange={(e) => patchAction(i, { ownerId: e.target.value })}>
                      <option value="">{t('Responsible person')}</option>
                      {m.participants.map((p) => <option key={p.user._id} value={p.user._id}>{p.user.fullName}</option>)}
                    </select>
                    <input className="input" style={{ width: 'auto' }} type="date" value={a.dueDate} onChange={(e) => patchAction(i, { dueDate: e.target.value })} />
                    <label className="row small" style={{ gap: 6 }}><input type="checkbox" checked={a.done} onChange={(e) => patchAction(i, { done: e.target.checked })} /> {t('Done')}</label>
                    <button className="icon-btn" onClick={() => setActions((xs) => xs.filter((_, idx) => idx !== i))} aria-label={t('Remove')}><Trash2 size={16} /></button>
                  </div>
                ))}
                <button className="btn btn-ghost btn-sm" style={{ alignSelf: 'flex-start' }} onClick={() => setActions((xs) => [...xs, { title: '', ownerId: '', dueDate: '', done: false }])}><Plus size={14} /> {t('Add an action')}</button>
              </div>
              <div className="stack-sm">
                <span className="label">{t('Who attended?')}</span>
                <div className="check-grid">
                  {m.participants.map((p) => (
                    <label key={p.user._id}><input type="checkbox" checked={attended.has(p.user._id)} onChange={() => toggleAttended(p.user._id)} /> {p.user.fullName}</label>
                  ))}
                </div>
              </div>
              <button className="btn btn-primary" style={{ alignSelf: 'flex-start' }} disabled={busy} onClick={saveMinutes}><Save size={16} /> {t('Save minutes')}</button>
            </>
          ) : (
            <>
              <p style={{ whiteSpace: 'pre-wrap' }}>{m.minutes}</p>
              {(m.actions || []).length > 0 && (
                <div className="list">
                  {m.actions.map((a) => (
                    <div key={a._id} className="list-item">
                      <div className="grow"><strong>{a.title}</strong><div className="muted small">{a.owner?.fullName}{a.dueDate ? ` · ${fmtLocalDate(a.dueDate, lang)}` : ''}</div></div>
                      <Badge tone={a.done ? 'good' : 'warn'}>{a.done ? t('Done') : t('Open')}</Badge>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </section>
      )}

      {editing && <MeetingForm meeting={m} onClose={() => setEditing(false)} onSaved={() => { setEditing(false); reload(); }} />}
      {cancelling && (
        <Modal title={t('Cancel this meeting?')} onClose={() => setCancelling(false)}
          footer={<>
            <button className="btn btn-ghost" onClick={() => setCancelling(false)}>{t('Back')}</button>
            <button className="btn btn-danger" onClick={cancel} disabled={busy}>{t('Cancel meeting')}</button>
          </>}>
          <p style={{ marginBottom: 10 }}>{t('Everybody invited is told that the meeting was cancelled.')}</p>
          <div className="field">
            <label>{t('Reason (optional)')}</label>
            <textarea className="textarea" value={reason} maxLength={500} onChange={(e) => setReason(e.target.value)} />
          </div>
        </Modal>
      )}
    </div>
  );
}
