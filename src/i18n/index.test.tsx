// @vitest-environment happy-dom
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { useAppStore } from '../app/store';
import { MESSAGES, currentMessages, followLocale, useT } from './index';

const initial = useAppStore.getState();
afterEach(() => {
  cleanup();
  useAppStore.setState(initial, true);
});

function AppName() {
  return <h1>{useT().common.appName}</h1>;
}

describe('messages', () => {
  it('starts in English in tests (the device reports en-US)', () => {
    expect(useAppStore.getState().locale).toBe('en');
    expect(currentMessages()).toBe(MESSAGES.en);
  });

  it('re-renders in the new language right away', () => {
    render(<AppName />);
    expect(screen.getByRole('heading').textContent).toBe('AI Investment Manager');
    act(() => useAppStore.setState({ locale: 'zh' }));
    expect(screen.getByRole('heading').textContent).toBe('AI 投资管理器');
    expect(currentMessages()).toBe(MESSAGES.zh);
  });

  // Screen readers and fonts read <html lang>; the tab title is the app name
  it('keeps the page language and title in step', () => {
    const stop = followLocale(document);
    expect(document.documentElement.lang).toBe('en');
    expect(document.title).toBe('AI Investment Manager');
    useAppStore.setState({ locale: 'zh' });
    expect(document.documentElement.lang).toBe('zh-CN');
    expect(document.title).toBe('AI 投资管理器');
    stop();
    useAppStore.setState({ locale: 'en' });
    expect(document.title).toBe('AI 投资管理器');
  });
});
