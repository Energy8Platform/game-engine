export * from './book';
export { deriveArrayFields } from './schema';
export { enrichConfigWithJurisdiction } from './jurisdiction';
export type { RegulatoryMapping } from './jurisdiction';
export {
  DEFAULT_PRE_REPLACEMENTS,
  DEFAULT_POST_REPLACEMENTS,
  applySocialText,
  ensureSocialDictionary,
} from './social';
export type { SocialRule } from './social';
