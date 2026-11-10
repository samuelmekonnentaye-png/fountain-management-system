import { useEffect, useMemo, useState } from 'react';
import { Building2, MapPin, Users, Video, Link2 } from 'lucide-react';
import api, { errMsg } from '../api/client.js';
import { useAuth } from '../context/AuthContext.jsx';
import { useI18n } from '../context/I18nContext.jsx';
import { useToast } from '../context/ToastContext.jsx';
import { useFetch } from '../hooks/useFetch.js';
import { deptName, toLocalDateInput, toLocalTimeInput } from '../utils/format.js';
import { Modal } from './ui.jsx';
import RecipientPicker from './RecipientPicker.jsx';

const CHANNELS = [
  ['zoom', Video, 'Zoom', 'Paste the Zoom link of the meeting.'],
  ['link', Link2, 'Other online link', 'Google Meet, Teams or any other link.'],
  ['in_person', MapPin, 'In person', 'A room at the office or another place.'],
];
const DURATIONS = [15, 30, 45, 60, 90, 120, 180, 240];

// Create or edit a meeting. Departments are invited as a whole, or only their heads.
export default function MeetingForm({ meeting, onClose, onSaved }) {
  const { user } = useAuth();
  const { t, lang } = useI18n();
  const toast = useToast();
  const depts = useFetch(() => api.get('/departments').then((r) => r.data.items), []);
  const editing = Boolean(meeting);

  const initial = useMemo(() => {
    const start = meeting ? new Date(meeting.startsAt) : new Date(Date.now() + 24 * 3600 * 1000);
    if (!meeting) start.setHours(9, 0, 0, 0);
    const invites = {};
    (meeting?.invites || []).forEach((i) => {
      invites[i.department._id] = { scope: i.scope, includeSubunits: i.includeSubunits };
    });
    return {
      title: meeting?.title || '',
      agenda: meeting?.agenda || '',
      date: toLocalDateInput(start),
      time: toLocalTimeInput(start),
      duration: meeting?.durationMinutes || 60,
      channel: meeting?.channel === 'audio' ? 'link' : meeting?.channel || 'zoom',
      joinUrl: meeting?.joinUrl || '',
      meetingNumber: meeting?.meetingNumber || '',
      passcode: meeting?.passcode || '',
      location: meeting?.location || '',
      hostDepartmentId: meeting?.hostDepartment?._id || user.department?._id || '',
      invites,
      people: meeting?.invitedUsers || [],
    };
  }, [meeting, user.department]);

  const [f, setF] = useState(initial);
  const [preview, setPreview] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => setPreview(null), [f.invites, f.people]);
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }));

  const toggleDept = (id) =>
    setF((x) => {
      const invites = { ...x.invites };
      if (invites[id]) delete invites[id];
      else invites[id] = { scope: 'all', includeSubunits: true };
      return { ...x, invites };
    });
  const setInvite = (id, patch) => setF((x) => ({ ...x, invites: { ...x.invites, [id]: { ...x.invites[id], ...patch } } }));

  const payloadInvites = () =>
    Object.entries(f.invites).map(([departmentId, v]) => ({ departmentId, scope: v.scope, includeSubunits: v.includeSubunits }));

  const doPreview = async () => {
    try {
      const r = await api.post('/meetings/preview', { invites: payloadInvites(), invitedUserIds: f.people.map((p) => p._id) });
      setPreview(r.data);
    } catch (e) {
      setError(errMsg(e));
    }
  };

  const save = async () => {
    setError('');
    if (!f.date || !f.time) {
      setError(t('Choose the date and the time'));
      return;
    }
    const startsAt = new Date(`${f.date}T${f.time}`);
    if (Number.isNaN(startsAt.getTime())) {
      setError(t('Choose the date and the time'));
      return;
    }
    setBusy(true);
    try {
      const body = {
        title: f.title, agenda: f.agenda, startsAt: startsAt.toISOString(), durationMinutes: Number(f.duration),
        channel: f.channel, joinUrl: f.channel === 'in_person' ? '' : f.joinUrl,
        meetingNumber: f.channel === 'zoom' ? f.meetingNumber : '', passcode: f.channel === 'zoom' ? f.passcode : '',
        location: f.channel === 'in_person' ? f.location : '',
        hostDepartmentId: f.hostDepartmentId || null,
        invites: payloadInvites(), invitedUserIds: f.people.map((p) => p._id),
      };
      const r = editing ? await api.patch(`/meetings/${meeting._id}`, body) : await api.post('/meetings', body);
      const conflicts = r.data.conflicts || [];
      toast.success(
        conflicts.length ? t('Saved. {n} invited people already have another meeting at this time.', { n: new Set(conflicts.map((c) => c.name)).size }) : t('Meeting saved')
      );
      onSaved(editing ? meeting._id : r.data.meeting._id);
    } catch (e) {
      setError(errMsg(e));
      setBusy(false);
    }
  };

  return (
    <Modal
      title={editing ? t('Edit meeting') : t('New meeting')}
      onClose={busy ? () => {} : onClose}
      wide
      footer={
        <>
          <button className="btn btn-ghost" onClick={onClose} disabled={busy}>{t('Cancel')}</button>
          <button className="btn btn-primary" onClick={save} disabled={busy || f.title.trim().length < 3}>
            {busy ? t('Saving…') : editing ? t('Save changes') : t('Create meeting')}
          </button>
        </>
      }
    >
      <div className="stack">
        <div className="field"><label>{t('Title')}</label><input className="input" value={f.title} onChange={set('title')} maxLength={200} autoFocus /></div>
        <div className="field"><label>{t('Agenda')}</label><textarea className="textarea" value={f.agenda} onChange={set('agenda')} maxLength={4000} /></div>

        <div className="form-grid">
          <div className="field"><label>{t('Date')}</label><input className="input" type="date" value={f.date} onChange={set('date')} /></div>
          <div className="field"><label>{t('Start time')}</label><input className="input" type="time" value={f.time} onChange={set('time')} /></div>
          <div className="field"><label>{t('Duration')}</label>
            <select className="select" value={f.duration} onChange={set('duration')}>
              {DURATIONS.map((d) => <option key={d} value={d}>{t('{n} minutes', { n: d })}</option>)}
            </select>
          </div>
          <div className="field"><label>{t('Host department')}</label>
            <select className="select" value={f.hostDepartmentId} onChange={set('hostDepartmentId')}>
              <option value="">{t('No department')}</option>
              {(depts.data || []).map((d) => <option key={d._id} value={d._id}>{deptName(d, lang)}</option>)}
            </select>
          </div>
        </div>

        <div className="stack-sm">
          <span className="label">{t('How will the meeting take place?')}</span>
          <div className="grid cols-3" style={{ gap: 10 }}>
            {CHANNELS.map(([value, Icon, label, hint]) => (
              <label key={value} className={`choice ${f.channel === value ? 'active' : ''}`}>
                <input type="radio" name="channel" value={value} checked={f.channel === value} onChange={() => setF((x) => ({ ...x, channel: value }))} />
                <Icon size={20} />
                <span><strong>{t(label)}</strong><span className="muted small">{t(hint)}</span></span>
              </label>
            ))}
          </div>
          {f.channel !== 'in_person' ? (
            <div className="form-grid">
              <div className="field full"><label>{f.channel === 'zoom' ? t('Zoom link') : t('Meeting link')}</label>
                <input className="input" value={f.joinUrl} onChange={set('joinUrl')} placeholder="https://" maxLength={500} />
                <span className="hint">{t('You can add or change the link later. The people invited are told about the change.')}</span>
              </div>
              {f.channel === 'zoom' && (
                <>
                  <div className="field"><label>{t('Zoom meeting ID (optional)')}</label><input className="input" value={f.meetingNumber} onChange={set('meetingNumber')} maxLength={40} /></div>
                  <div className="field"><label>{t('Passcode (optional)')}</label><input className="input" value={f.passcode} onChange={set('passcode')} maxLength={40} /></div>
                </>
              )}
            </div>
          ) : (
            <div className="field"><label>{t('Place')}</label><input className="input" value={f.location} onChange={set('location')} maxLength={200} placeholder={t('e.g. Head office, meeting room 2')} /></div>
          )}
        </div>

        <div className="stack-sm">
          <span className="label"><Building2 size={15} style={{ verticalAlign: '-2px' }} /> {t('Invite departments')}</span>
          <div className="invite-list">
            {(depts.data || []).map((d) => {
              const on = Boolean(f.invites[d._id]);
              return (
                <div key={d._id} className={`invite-row ${on ? 'on' : ''}`}>
                  <label className="row" style={{ gap: 8, cursor: 'pointer', flex: 1 }}>
                    <input type="checkbox" checked={on} onChange={() => toggleDept(d._id)} />
                    <span>{deptName(d, lang)}</span>
                  </label>
                  {on && (
                    <>
                      <select className="select" style={{ width: 'auto', padding: '4px 8px' }} value={f.invites[d._id].scope} onChange={(e) => setInvite(d._id, { scope: e.target.value })}>
                        <option value="all">{t('Everybody')}</option>
                        <option value="heads">{t('Heads only')}</option>
                      </select>
                      <label className="row small" style={{ gap: 6, cursor: 'pointer' }}>
                        <input type="checkbox" checked={f.invites[d._id].includeSubunits} onChange={(e) => setInvite(d._id, { includeSubunits: e.target.checked })} />
                        {t('with sub-units')}
                      </label>
                    </>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        <RecipientPicker label={t('Invite people')} value={f.people} onChange={(v) => setF((x) => ({ ...x, people: v }))} max={100}
          hint={t('Single people, in addition to the departments above.')} />

        <div className="stack-sm">
          <div className="row" style={{ gap: 10 }}>
            <button className="btn btn-ghost btn-sm" type="button" onClick={doPreview}><Users size={15} /> {t('Show who will be invited')}</button>
            {preview && <strong>{t('{n} people (you included)', { n: preview.count })}</strong>}
          </div>
          {preview && (
            <div className="muted small" style={{ maxHeight: 120, overflowY: 'auto' }}>
              {preview.items.map((p) => `${p.fullName}${p.department ? ` (${p.department})` : ''}`).join(' · ')}
            </div>
          )}
        </div>
        {error && <div className="error-text" role="alert">{error}</div>}
      </div>
    </Modal>
  );
}
