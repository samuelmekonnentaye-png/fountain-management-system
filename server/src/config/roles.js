export const ROLES = {
  EMPLOYEE: 'employee',
  DEPARTMENT_HEAD: 'department_head',
  MANAGER: 'manager',
  DEPUTY_GM: 'deputy_general_manager',
  GM: 'general_manager',
  ADMIN: 'system_admin',
};
export const ROLE_LIST = Object.values(ROLES);

// Order used to pick the single role that is displayed for a user who has several.
export const ROLE_RANK = [ROLES.ADMIN, ROLES.GM, ROLES.DEPUTY_GM, ROLES.MANAGER, ROLES.DEPARTMENT_HEAD, ROLES.EMPLOYEE];

// Who may see aggregated performance numbers (never report contents).
export const TEAM_ROLES = [ROLES.DEPARTMENT_HEAD, ROLES.MANAGER, ROLES.DEPUTY_GM, ROLES.GM];

export const hasRole = (user, ...roles) => roles.some((r) => user?.roles?.includes(r));
export const primaryRole = (roles = []) => ROLE_RANK.find((r) => roles.includes(r)) || ROLES.EMPLOYEE;

// 'all'  -> whole organisation (General Manager, Deputy GM)
// 'team' -> own department + direct reports (Manager, Department Head)
// 'none' -> no access to performance analytics
export function scopeKind(roles = []) {
  if (roles.includes(ROLES.GM) || roles.includes(ROLES.DEPUTY_GM)) return 'all';
  if (roles.includes(ROLES.MANAGER) || roles.includes(ROLES.DEPARTMENT_HEAD)) return 'team';
  return 'none';
}
