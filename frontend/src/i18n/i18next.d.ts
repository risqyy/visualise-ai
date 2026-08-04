import type { AppResources } from './resources'

/**
 * Typed translation keys.
 *
 * i18next reads the resource shape from this augmentation, so `t()` only
 * accepts keys that actually exist in the German catalogue and `tsc` rejects a
 * typo, a renamed key and a key removed from a catalogue but not from the code.
 *
 * It also enforces one half of the translation contract for free: a reported
 * value — a component id, a file path, an agent message — is not a member of
 * this union, so `t(component.componentId)` does not compile. Passing reported
 * data through the translation layer is a type error, not a review finding.
 *
 * `returnNull: false` matches `createI18n`, so `t()` is typed `string` and not
 * `string | null` at every call site.
 */
declare module 'i18next' {
  interface CustomTypeOptions {
    defaultNS: 'common'
    resources: AppResources
    returnNull: false
  }
}
