import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { useAuth } from './context/AuthContext.jsx';
import { useI18n } from './context/I18nContext.jsx';
import { ROLES, TEAM_ROLES, hasRole, isAdminOnly } from './utils/roles.js';
import Layout from './components/Layout.jsx';
import { PageLoader, EmptyState } from './components/ui.jsx';
import Login from './pages/Login.jsx';
import Register from './pages/Register.jsx';
import Dashboard from './pages/Dashboard.jsx';
import Plans from './pages/Plans.jsx';
import PlanEditor from './pages/PlanEditor.jsx';
import ReportsList from './pages/ReportsList.jsx';
import ReportView from './pages/ReportView.jsx';
import Team from './pages/Team.jsx';
import Notifications from './pages/Notifications.jsx';
import Profile from './pages/Profile.jsx';
import Users from './pages/admin/Users.jsx';
import Departments from './pages/admin/Departments.jsx';
import Audit from './pages/admin/Audit.jsx';
import Periods from './pages/admin/Periods.jsx';
import AdminDashboard from './pages/admin/AdminDashboard.jsx';
import Registrations from './pages/admin/Registrations.jsx';
import OrgStructure from './pages/admin/OrgStructure.jsx';
import Meetings from './pages/Meetings.jsx';
import MeetingView from './pages/MeetingView.jsx';

function RequireAuth({ children }) {
  const { user, loading } = useAuth();
  const location = useLocation();
  if (loading) return <div style={{ paddingTop: '30vh' }}><PageLoader /></div>;
  if (!user) return <Navigate to="/login" state={{ from: location.pathname }} replace />;
  if (user.mustChangePassword && location.pathname !== '/profile') return <Navigate to="/profile" replace />;
  return children;
}

function RequireRole({ roles, children }) {
  const { user } = useAuth();
  const { t } = useI18n();
  if (!hasRole(user, ...roles)) {
    return <div className="page"><section className="glass card"><EmptyState title={t('You do not have access to this page')} /></section></div>;
  }
  return children;
}

// The System Admin gets a monitoring dashboard; everybody else gets the personal one.
function Home() {
  const { user } = useAuth();
  return isAdminOnly(user) ? <AdminDashboard /> : <Dashboard />;
}

export default function App() {
  const { t } = useI18n();
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/register" element={<Register />} />
      <Route element={<RequireAuth><Layout /></RequireAuth>}>
        <Route index element={<Home />} />
        <Route path="plans" element={<Plans />} />
        <Route path="plans/:id" element={<PlanEditor />} />
        <Route path="inbox" element={<ReportsList box="inbox" />} />
        <Route path="sent" element={<ReportsList box="sent" />} />
        <Route path="reports/:id" element={<ReportView />} />
        <Route path="team" element={<RequireRole roles={TEAM_ROLES}><Team /></RequireRole>} />
        <Route path="meetings" element={<Meetings />} />
        <Route path="meetings/:id" element={<MeetingView />} />
        <Route path="notifications" element={<Notifications />} />
        <Route path="profile" element={<Profile />} />
        <Route path="admin/users" element={<RequireRole roles={[ROLES.ADMIN]}><Users /></RequireRole>} />
        <Route path="admin/departments" element={<RequireRole roles={[ROLES.ADMIN]}><Departments /></RequireRole>} />
        <Route path="admin/periods" element={<RequireRole roles={[ROLES.ADMIN, ROLES.GM]}><Periods /></RequireRole>} />
        <Route path="admin/registrations" element={<RequireRole roles={[ROLES.ADMIN]}><Registrations /></RequireRole>} />
        <Route path="admin/org" element={<RequireRole roles={[ROLES.ADMIN]}><OrgStructure /></RequireRole>} />
        <Route path="admin/audit" element={<RequireRole roles={[ROLES.ADMIN]}><Audit /></RequireRole>} />
        <Route path="*" element={<div className="page"><section className="glass card"><EmptyState title={t('Page not found')} /></section></div>} />
      </Route>
    </Routes>
  );
}
