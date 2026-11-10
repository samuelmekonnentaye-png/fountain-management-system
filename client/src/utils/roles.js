export const ROLES = {
  EMPLOYEE: 'employee',
  DEPARTMENT_HEAD: 'department_head',
  MANAGER: 'manager',
  DEPUTY_GM: 'deputy_general_manager',
  GM: 'general_manager',
  ADMIN: 'system_admin',
};
export const ROLE_LIST = Object.values(ROLES);
export const TEAM_ROLES = [ROLES.DEPARTMENT_HEAD, ROLES.MANAGER, ROLES.DEPUTY_GM, ROLES.GM];
const RANK = [ROLES.ADMIN, ROLES.GM, ROLES.DEPUTY_GM, ROLES.MANAGER, ROLES.DEPARTMENT_HEAD, ROLES.EMPLOYEE];

export const ROLE_LABEL = {
  employee: 'Employee',
  department_head: 'Department Head',
  manager: 'Manager',
  deputy_general_manager: 'Deputy General Manager',
  general_manager: 'General Manager',
  system_admin: 'System Admin',
};

// A person can hold several roles; these helpers work on the `roles` array.
export const hasRole = (user, ...roles) => roles.some((r) => user?.roles?.includes(r));
export const primaryRole = (roles = []) => RANK.find((r) => roles.includes(r)) || ROLES.EMPLOYEE;
export const userRole = (u) => u?.primaryRole || primaryRole(u?.roles || []);
// The System Admin only administers the system: no plans, no inbox, a monitoring dashboard instead.
export const isAdminOnly = (user) => Boolean(user?.roles?.length) && user.roles.every((r) => r === ROLES.ADMIN);
