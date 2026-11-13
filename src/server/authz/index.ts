import 'server-only';

export { classifyPortalAccess, type PortalAccess } from './portal-access';
export { switchCapacity, type CapacityTarget } from './capacity';
export {
  getAuthzContext,
  loadCapacities,
  resolveAuthzContext,
  restrictCapacitiesToHost,
  selectCapacity,
  type AuthzContext,
  type Capacity,
  type ContextHints,
  type OrgStatus,
} from './context';
export {
  ACTING_AS,
  MEMBERSHIP_ROLES,
  PERMISSIONS,
  PERMISSION_NAMES,
  getPermissionRule,
  type ActingAs,
  type MembershipRole,
  type Permission,
  type PermissionRule,
} from './permissions';
export {
  evaluatePermission,
  requirePermission,
  type AuthzSubject,
  type Decision,
  type PermissionScope,
} from './policy';
