import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { CalendarDays, Clock, MapPin, Plus, Video, Users } from 'lucide-react';
import { useAuth } from '../context/AuthContext.jsx';
import { useI18n } from '../context/I18nContext.jsx';
import api from '../api/client.js';
import { useFetch } from '../hooks/useFetch.js';
import { deptName, fmtLocalDate, sameLocalDay, timeRange } from '../utils/format.js';
import { TEAM_ROLES, hasRole } from '../utils/roles.js';
import { Badge, EmptyState, ErrorBox, PageHead, PageLoader, Pagination } from '../components/ui.jsx';
import MeetingForm from '../components/MeetingForm.jsx';

export const CHANNEL_LABEL = { zoom: 'Zoom', link: 'Online', in_person: 'In person', audio: 'Audio' };

export function RsvpBadge({ status }) {
  const { t } = useI18n();
  const map = { accepted: ['Accepted', 'good'], declined: ['Declined', 'bad'], tentative: ['Maybe', 'warn'], invited: ['Waiting for your answer', 'blue'] };
  const [label, tone] = map[status] || [];
  return label ? <Badge tone={tone}>{t(label)}</Badge> : null;
}

export function MeetingCard({ m, onClick }) {
  const { t, lang } = useI18n();
  const Icon = m.channel === 'in_person' ? MapPin : Video;
  return (
    <div className={`glass card-tight meeting-card ${m.status === 'cancelled' ? 'cancelled' : ''}`} onClick={onClick} role="link" tabIndex={0}
      onKeyDown={(e) => e.key === 'Enter' && onClick()}>
      <div className="meeting-time">
        <strong>{timeRange(m.startsAt, m.endsAt)}</strong>
        <span className="muted small">{fmtLocalDate(m.startsAt, lang)}</span>
      </div>
      <div className="grow">
        <div className="row wrap" style={{ gap: 8 }}>
          <strong>{m.title}</strong>
          {m.phase === 'live' && <Badge tone="good">{t('Live now')}</Badge>}
          {m.status === 'cancelled' && <Badge tone="bad">{t('Cancelled')}</Badge>}
          {m.status === 'completed' && <Badge>{t('Finished')}</Badge>}
          {!m.isOrganizer && m.status === 'scheduled' && <RsvpBadge status={m.myStatus} />}
        </div>
        <div className="muted small row wrap" style={{ gap: 12, marginTop: 4 }}>
          <span className="row" style={{ gap: 4 }}><Icon size={14} /> {t(CHANNEL_LABEL[m.channel])}{m.channel === 'in_person' && m.location ? ` · ${m.location}` : ''}</span>
          <span className="row" style={{ gap: 4 }}><Users size={14} /> {t('{a} of {b} accepted', { a: m.acceptedCount, b: m.participantCount })}</span>
          {m.hostDepartment && <span>{deptName(m.hostDepartment, lang)}</span>}
          <span>{m.isOrganizer ? t('You organize this meeting') : m.organizer?.fullName}</span>
        </div>
      </div>
      {m.joinOpen && m.hasLink && <span className="btn btn-primary btn-sm"><Video size={14} /> {t('Join')}</span>}
    </div>
  );
}

export default function Meetings() {
  const { user } = useAuth();
  const { t, lang } = useI18n();
  const navigate = useNavigate();
  const [tab, setTab] = useState('upcoming');
  const [page, setPage] = useState(1);
  const [creating, setCreating] = useState(false);
  const { data, loading, error, reload } = useFetch(
    () => api.get('/meetings', { params: { scope: tab, page, limit: 20 } }).then((r) => r.data),
    [tab, page]
  );
  const canOrganize = hasRole(user, ...TEAM_ROLES);
  const go = (id) => navigate(`/meetings/${id}`);
  const setTabAndReset = (x) => { setTab(x); setPage(1); };

  // group by day (the viewer's own day)
  const groups = [];
  (data?.items || []).forEach((m) => {
    const last = groups[groups.length - 1];
    if (last && sameLocalDay(last.date, m.startsAt)) last.items.push(m);
    else groups.push({ date: m.startsAt, items: [m] });
  });
  const today = new Date();
  const tomorrow = new Date(Date.now() + 86400000);
  const dayLabel = (d) => (sameLocalDay(d, today) ? t('Today') : sameLocalDay(d, tomorrow) ? t('Tomorrow') : fmtLocalDate(d, lang));

  return (
    <div className="page">
      <PageHead
        title={t('Meetings')}
        subtitle={t('Meetings between departments and people. Join with Zoom or any other link.')}
        actions={canOrganize && <button className="btn btn-primary" onClick={() => setCreating(true)}><Plus size={16} /> {t('New meeting')}</button>}
      />
      <div className="tabs" role="tablist" style={{ alignSelf: 'flex-start' }}>
        {[['upcoming', 'Upcoming'], ['past', 'Past'], ...(canOrganize ? [['organized', 'Organized by me']] : [])].map(([v, l]) => (
          <button key={v} role="tab" aria-selected={tab === v} className={`tab ${tab === v ? 'active' : ''}`} onClick={() => setTabAndReset(v)}>{t(l)}</button>
        ))}
      </div>
      <ErrorBox error={error} onRetry={reload} />
      {loading && !data ? <PageLoader /> : data && data.items.length === 0 ? (
        <section className="glass card">
          <EmptyState icon={CalendarDays} title={tab === 'past' ? t('No past meetings') : t('No meetings yet')}
            text={canOrganize ? t('Press "New meeting" to invite departments and people.') : t('When somebody invites you, the meeting appears here.')} />
        </section>
      ) : (
        <div className="stack">
          {groups.map((g) => (
            <section key={g.date + g.items[0]._id} className="stack-sm">
              <h3 className="row" style={{ gap: 8 }}><Clock size={16} /> {dayLabel(g.date)}</h3>
              {g.items.map((m) => <MeetingCard key={m._id} m={m} onClick={() => go(m._id)} />)}
            </section>
          ))}
          {data && <Pagination page={data.page} pages={data.pages} onChange={setPage} />}
        </div>
      )}
      {creating && <MeetingForm onClose={() => setCreating(false)} onSaved={(id) => { setCreating(false); reload(); go(id); }} />}
      <Link to="/notifications" className="sr-only">{t('Notifications')}</Link>
    </div>
  );
}
