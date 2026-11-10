import { useEffect, useState } from 'react';
import { NavLink, Outlet, Link, useLocation } from 'react-router-dom';
import {
  LayoutDashboard, CalendarCheck, Inbox, Send, BarChart3, Bell, Users, Building2, ScrollText,
  UserCircle, LogOut, Languages, Menu, CalendarRange, UserCheck, Network, Video,
} from 'lucide-react';
import api from '../api/client.js';
import { useAuth } from '../context/AuthContext.jsx';
import { useI18n, COMPANY } from '../context/I18nContext.jsx';
import { ROLES, TEAM_ROLES, ROLE_LABEL, hasRole, isAdminOnly } from '../utils/roles.js';
import Logo from './Logo.jsx';

export default function Layout() {
  const { user, logout } = useAuth();
  const { t, lang, setLang } = useI18n();
  const location = useLocation();
  const [open, setOpen] = useState(false);
  const [counts, setCounts] = useState({ unread: 0, notifications: 0, pending: 0, meetings: 0 });
  const adminOnly = isAdminOnly(user);
  const isAdmin = hasRole(user, ROLES.ADMIN);

  useEffect(() => setOpen(false), [location.pathname]);

  useEffect(() => {
    if (user.mustChangePassword) return undefined;
    let alive = true;
    const load = async () => {
      try {
        const [s, n, p, mt] = await Promise.all([
          adminOnly ? Promise.resolve({ data: { unread: 0 } }) : api.get('/reports/stats'),
          api.get('/notifications', { params: { limit: 1 } }),
          isAdmin ? api.get('/users/pending-count') : Promise.resolve({ data: { count: 0 } }),
          adminOnly ? Promise.resolve({ data: { awaiting: 0 } }) : api.get('/meetings/stats'),
        ]);
        if (alive) setCounts({ unread: s.data.unread, notifications: n.data.unread, pending: p.data.count, meetings: mt.data.awaiting });
      } catch {
        /* the badges are optional */
      }
    };
    load();
    const h = setInterval(load, 60000);
    return () => {
      alive = false;
      clearInterval(h);
    };
  }, [location.pathname, user.mustChangePassword, adminOnly, isAdmin]);

  const dashboard = { to: '/', icon: LayoutDashboard, label: 'Dashboard', end: true };
  const notificationsLink = { to: '/notifications', icon: Bell, label: 'Notifications', count: counts.notifications };
  const adminLinks = [
    { to: '/admin/registrations', icon: UserCheck, label: 'Registration requests', count: counts.pending },
    { to: '/admin/users', icon: Users, label: 'Users' },
    { to: '/admin/org', icon: Network, label: 'Organization chart' },
    { to: '/admin/departments', icon: Building2, label: 'Departments' },
    { to: '/admin/periods', icon: CalendarRange, label: 'Reporting periods' },
    { to: '/admin/audit', icon: ScrollText, label: 'Audit trail' },
  ];

  // The System Admin only administers and monitors; everybody else works with plans and reports.
  let main;
  let admin = [];
  if (adminOnly) {
    main = [dashboard, ...adminLinks, notificationsLink];
  } else {
    main = [
      dashboard,
      { to: '/plans', icon: CalendarCheck, label: 'My work plans' },
      { to: '/inbox', icon: Inbox, label: 'Inbox', count: counts.unread },
      { to: '/sent', icon: Send, label: 'Sent reports' },
      { to: '/meetings', icon: Video, label: 'Meetings', count: counts.meetings },
    ];
    if (hasRole(user, ...TEAM_ROLES)) main.push({ to: '/team', icon: BarChart3, label: 'Team performance' });
    main.push(notificationsLink);
    // The General Manager also manages the reporting periods
    if (!isAdmin && hasRole(user, ROLES.GM)) main.push({ to: '/admin/periods', icon: CalendarRange, label: 'Reporting periods' });
    if (isAdmin) admin = adminLinks;
  }

  const renderLink = (n) => (
    <NavLink key={n.to} to={n.to} end={n.end} className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}>
      <n.icon size={19} />
      <span>{t(n.label)}</span>
      {n.count > 0 && <span className="count">{n.count > 99 ? '99+' : n.count}</span>}
    </NavLink>
  );

  return (
    <div className="app-shell">
      <div className={`scrim ${open ? 'open' : ''}`} onClick={() => setOpen(false)} />
      <aside className={`sidebar glass ${open ? 'open' : ''}`}>
        <Logo />
        <nav className="nav" aria-label="Main">
          {main.map(renderLink)}
          {admin.length > 0 && (
            <>
              <div className="nav-group">{t('Administration')}</div>
              {admin.map(renderLink)}
            </>
          )}
        </nav>
        <div className="sidebar-foot">
          {renderLink({ to: '/profile', icon: UserCircle, label: 'My profile' })}
        </div>
      </aside>

      <div className="app-main">
        <header className="topbar glass">
          <button className="icon-btn menu-btn" onClick={() => setOpen(true)} aria-label={t('Open menu')}>
            <Menu size={22} />
          </button>
          <span className="company">{COMPANY[lang]}</span>
          <span className="grow" />
          <button className="btn btn-ghost btn-sm" onClick={() => setLang(lang === 'am' ? 'en' : 'am')} title={t('Language')}>
            <Languages size={16} /> {lang === 'am' ? 'English' : 'አማርኛ'}
          </button>
          <Link to="/notifications" className="icon-btn" aria-label={t('Notifications')}>
            <Bell size={20} />
            {counts.notifications > 0 && <span className="dot">{counts.notifications > 99 ? '99+' : counts.notifications}</span>}
          </Link>
          <Link to="/profile" className="row" style={{ gap: 8, color: 'inherit', textDecoration: 'none' }}>
            <div style={{ textAlign: 'right', lineHeight: 1.2 }}>
              <strong style={{ fontSize: '0.88rem' }}>{user.fullName}</strong>
              <div className="muted" style={{ fontSize: '0.74rem' }}>{user.roles.map((r) => t(ROLE_LABEL[r])).join(' · ')}</div>
            </div>
          </Link>
          <button className="icon-btn" onClick={logout} aria-label={t('Sign out')} title={t('Sign out')}>
            <LogOut size={20} />
          </button>
        </header>
        <Outlet />
      </div>
    </div>
  );
}
