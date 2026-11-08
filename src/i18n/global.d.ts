import type { Locale } from './routing';
import type messages from '../../messages/es.json';

declare module 'next-intl' {
  interface AppConfig {
    Locale: Locale;
    Messages: typeof messages;
  }
}
