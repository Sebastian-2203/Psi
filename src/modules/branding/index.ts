// Public surface of the branding module (ARCHITECTURE §4 rule 1). Server code lives in
// `@/modules/branding/server/*` (actions, queries) and is imported by routes directly.
export { BrandingSettings } from './components/branding-form';
export { evaluateBrandColors } from './lib/contrast-guard';
