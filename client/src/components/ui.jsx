import { useEffect } from 'react';
import { ChevronLeft, ChevronRight, X, Inbox } from 'lucide-react';
import { useI18n } from '../context/I18nContext.jsx';
import { scoreColor } from '../utils/scores.js';
import { ROLE_LABEL, userRole } from '../utils/roles.js';

export function Spinner() {
  return <div className="spinner" role="progressbar" aria-label="Loading" />;
}
export function PageLoader() {
  return (
    <div className="loader">
      <Spinner />
    </div>
  );
}

export function ErrorBox({ error, onRetry }) {
  const { t } = useI18n();
  if (!error) return null;
  return (
    <div className="alert alert-bad" role="alert">
      <div className="grow">{error}</div>
      {onRetry && (
        <button className="btn btn-ghost btn-sm" onClick={onRetry}>
          {t('Try again')}
        </button>
      )}
    </div>
  );
}

export function EmptyState({ icon: Icon = Inbox, title, text, action }) {
  return (
    <div className="empty">
      <Icon size={38} />
      <h3>{title}</h3>
      {text && <p>{text}</p>}
      {action && <div style={{ marginTop: 14 }}>{action}</div>}
    </div>
  );
}

export function PageHead({ title, subtitle, actions }) {
  return (
    <div className="page-head">
      <div>
        <h1>{title}</h1>
        {subtitle && <p>{subtitle}</p>}
      </div>
      {actions && <div className="row wrap no-print">{actions}</div>}
    </div>
  );
}

export const Badge = ({ tone = 'neutral', children }) => <span className={`badge badge-${tone}`}>{children}</span>;

const STATUS = {
  draft: ['Draft', 'neutral'],
  not_started: ['Not started', 'neutral'],
  submitted: ['Submitted', 'blue'],
  in_review: ['In review', 'blue'],
  forwarded: ['Forwarded', 'blue'],
  rejected: ['Rejected', 'bad'],
  direct: ['Direct', 'neutral'],
  hierarchical: ['Hierarchical', 'neutral'],
  approved: ['Approved', 'good'],
  returned: ['Returned', 'warn'],
  pending: ['Pending', 'neutral'],
  in_progress: ['In progress', 'blue'],
  completed: ['Completed', 'good'],
  not_completed: ['Not completed', 'bad'],
  cancelled: ['Cancelled', 'neutral'],
  plan: ['Work plan', 'blue'],
  evaluation: ['Monthly evaluation', 'blue'],
};
export const STATUS_COLORS = {
  pending: '#9fb3d1', in_progress: '#5bb4ff', completed: '#0e9f6e', not_completed: '#d64545', cancelled: '#c3cfe2',
};

export function StatusBadge({ status }) {
  const { t } = useI18n();
  const [label, tone] = STATUS[status] || [status, 'neutral'];
  return <Badge tone={tone}>{t(label)}</Badge>;
}

export function RoleBadge({ role }) {
  const { t } = useI18n();
  return <Badge tone="blue">{t(ROLE_LABEL[role] || role)}</Badge>;
}

// All roles of a user (a person can hold several).
export function RolesBadges({ user }) {
  const roles = user?.roles?.length ? user.roles : [userRole(user)];
  return (
    <span className="row wrap" style={{ gap: 4 }}>
      {roles.map((r) => <RoleBadge key={r} role={r} />)}
    </span>
  );
}

// Circular score gauge. value === null shows an empty ring.
export function ScoreRing({ value, size = 120, stroke = 12, caption }) {
  const v = value === null || value === undefined ? null : Math.max(0, Math.min(100, value));
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  return (
    <span className="ring" style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{ transform: 'rotate(-90deg)' }}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="rgba(88,112,145,.16)" strokeWidth={stroke} />
        {v !== null && (
          <circle
            cx={size / 2} cy={size / 2} r={r} fill="none" stroke={scoreColor(v)} strokeWidth={stroke}
            strokeLinecap="round" strokeDasharray={c} strokeDashoffset={c - (v / 100) * c}
            style={{ transition: 'stroke-dashoffset .5s ease' }}
          />
        )}
      </svg>
      <span className="ring-value" style={{ fontSize: size * 0.24 }}>
        {v === null ? '–' : `${v}%`}
        {caption && <small>{caption}</small>}
      </span>
    </span>
  );
}

export function Modal({ title, onClose, children, footer, wide }) {
  const { t } = useI18n();
  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose]);

  return (
    <div className="modal-back no-print" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`modal glass ${wide ? 'wide' : ''}`} role="dialog" aria-modal="true" aria-label={title}>
        <div className="modal-head">
          <h2>{title}</h2>
          <button className="icon-btn" onClick={onClose} aria-label={t('Close')}>
            <X size={20} />
          </button>
        </div>
        {children}
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>
  );
}

export function Pagination({ page, pages, onChange }) {
  const { t } = useI18n();
  if (pages <= 1) return null;
  return (
    <div className="pager no-print">
      <button className="btn btn-ghost btn-sm" disabled={page <= 1} onClick={() => onChange(page - 1)}>
        <ChevronLeft size={16} /> {t('Previous')}
      </button>
      <span className="muted small">{t('Page {page} of {pages}', { page, pages })}</span>
      <button className="btn btn-ghost btn-sm" disabled={page >= pages} onClick={() => onChange(page + 1)}>
        {t('Next')} <ChevronRight size={16} />
      </button>
    </div>
  );
}

export function Field({ label, hint, children, className = '' }) {
  return (
    <div className={`field ${className}`}>
      {label && <label>{label}</label>}
      {children}
      {hint && <span className="hint">{hint}</span>}
    </div>
  );
}
