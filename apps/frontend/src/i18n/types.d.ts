import type en from './locales/en.json'

// Augment i18next so t('...') is typed against en.json keys
declare module 'i18next' {
  interface CustomTypeOptions {
    defaultNS: 'translation'
    resources: {
      translation: typeof en
    }
  }
}
