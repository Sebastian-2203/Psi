import 'server-only';
/**
 * DEPRECATED compatibility shim (P1-04). `src/server/db/admin.ts` was split into
 * ./system.ts (app_server system functions) and ./service-role.ts (service-role Auth admin
 * API). This shim re-exports ONLY the system functions still used by src/server/tenancy/host.ts
 * (owned by the branding workstream). It never exposes the service-role client.
 * TODO(P1-04): switch host.ts to '@/server/db/system' and delete this file + its lint entry.
 */
export {
  systemGetPublicBranding,
  systemResolveOrganizationIdByHost,
  type PublicBrandingRow,
} from './system';
