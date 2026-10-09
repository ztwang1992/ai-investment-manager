// All interface copy, in English (the source language) and Chinese. Each feature has a message module
// in ./messages with both languages side by side; TypeScript checks that Chinese has every English key.
import { useAppStore } from '../app/store';
import { namesFor } from './catalog';
import type { Locale } from './locale';
import * as ai from './messages/ai';
import * as backup from './messages/backup';
import * as calibration from './messages/calibration';
import * as common from './messages/common';
import * as holdings from './messages/holdings';
import * as login from './messages/login';
import * as onboarding from './messages/onboarding';
import * as perf from './messages/perf';
import * as plan from './messages/plan';
import * as records from './messages/records';
import * as shell from './messages/shell';
import * as sync from './messages/sync';

const en = {
  /** Passed to the number formatters */
  locale: 'en' as Locale,
  /** Display names of preset groups, assets and instruments */
  names: namesFor('en'),
  common: common.en,
  shell: shell.en,
  login: login.en,
  sync: sync.en,
  backup: backup.en,
  perf: perf.en,
  plan: plan.en,
  calibration: calibration.en,
  holdings: holdings.en,
  records: records.en,
  onboarding: onboarding.en,
  ai: ai.en,
};

export type Messages = typeof en;

const zh: Messages = {
  locale: 'zh',
  names: namesFor('zh'),
  common: common.zh,
  shell: shell.zh,
  login: login.zh,
  sync: sync.zh,
  backup: backup.zh,
  perf: perf.zh,
  plan: plan.zh,
  calibration: calibration.zh,
  holdings: holdings.zh,
  records: records.zh,
  onboarding: onboarding.zh,
  ai: ai.zh,
};

export const MESSAGES: Record<Locale, Messages> = { en, zh };

/** The messages in the current language; the component re-renders when the language changes */
export function useT(): Messages {
  return useAppStore((s) => MESSAGES[s.locale]);
}

/** The messages in the current language, outside React (toasts from startup, onboarding) */
export function currentMessages(): Messages {
  return MESSAGES[useAppStore.getState().locale];
}

/** Keep <html lang> and the page title in step with the language. Started once in main.tsx; returns a stop function */
export function followLocale(doc: Document): () => void {
  const apply = (locale: Locale) => {
    doc.documentElement.lang = locale === 'zh' ? 'zh-CN' : 'en';
    doc.title = MESSAGES[locale].common.appName;
  };
  apply(useAppStore.getState().locale);
  return useAppStore.subscribe((s, prev) => {
    if (s.locale !== prev.locale) apply(s.locale);
  });
}
