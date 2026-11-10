import { useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import api from '../api/client.js';
import { useI18n } from '../context/I18nContext.jsx';
import { useDebounced } from '../hooks/useFetch.js';
import { ROLE_LABEL, userRole } from '../utils/roles.js';
import { deptName } from '../utils/format.js';

// Search-by-name picker over the registered users (like an email "To" / "CC" field).
export default function RecipientPicker({ label, hint, value, onChange, excludeIds = [], variant = 'to', placeholder, max = 30 }) {
  const { t, lang } = useI18n();
  const [q, setQ] = useState('');
  const dq = useDebounced(q, 250);
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const boxRef = useRef(null);

  useEffect(() => {
    if (dq.trim().length < 1) {
      setResults([]);
      return undefined;
    }
    let alive = true;
    setLoading(true);
    api
      .get('/users/search', { params: { q: dq.trim() } })
      .then((r) => {
        if (alive) {
          setResults(r.data.items);
          setActive(0);
        }
      })
      .catch(() => alive && setResults([]))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [dq]);

  useEffect(() => {
    const h = (e) => boxRef.current && !boxRef.current.contains(e.target) && setOpen(false);
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, []);

  const taken = new Set([...value.map((v) => v._id), ...excludeIds]);
  const options = results.filter((u) => !taken.has(u._id));

  const add = (u) => {
    onChange([...value, u]);
    setQ('');
    setResults([]);
    setOpen(false);
  };
  const remove = (id) => onChange(value.filter((v) => v._id !== id));

  const onKeyDown = (e) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((a) => Math.min(a + 1, options.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((a) => Math.max(a - 1, 0));
    } else if (e.key === 'Enter') {
      if (options[active]) {
        e.preventDefault();
        add(options[active]);
      }
    } else if (e.key === 'Escape') {
      setOpen(false);
    } else if (e.key === 'Backspace' && !q && value.length) {
      remove(value[value.length - 1]._id);
    }
  };

  return (
    <div className="field picker" ref={boxRef}>
      <label>{label}</label>
      {value.length > 0 && (
        <div className="picker-chips">
          {value.map((u) => (
            <span key={u._id} className={`chip ${variant === 'cc' ? 'cc' : ''}`}>
              {u.fullName}
              <button type="button" onClick={() => remove(u._id)} aria-label={t('Remove')}>
                <X size={12} />
              </button>
            </span>
          ))}
        </div>
      )}
      {value.length < max && (
      <input
        className="input"
        value={q}
        placeholder={placeholder || t('Search a user by name…')}
        onChange={(e) => {
          setQ(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={onKeyDown}
        autoComplete="off"
      />
      )}
      {value.length < max && open && q.trim() && (
        <div className="picker-results" role="listbox">
          {loading && <div className="muted small" style={{ padding: 10 }}>{t('Searching…')}</div>}
          {!loading && options.length === 0 && (
            <div className="muted small" style={{ padding: 10 }}>{t('No matching users')}</div>
          )}
          {options.map((u, i) => (
            <button
              type="button"
              key={u._id}
              className={`picker-option ${i === active ? 'active' : ''}`}
              onMouseDown={(e) => {
                e.preventDefault();
                add(u);
              }}
            >
              <strong>{u.fullName}</strong>
              <span className="muted small">
                {[t(ROLE_LABEL[userRole(u)] || userRole(u)), u.jobTitle, deptName(u.department, lang)].filter(Boolean).join(' · ')}
              </span>
            </button>
          ))}
        </div>
      )}
      {hint && <span className="hint">{hint}</span>}
    </div>
  );
}
