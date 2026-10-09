// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AuthError } from '../../app/auth';
import { useAppStore } from '../../app/store';
import type { AuthClient } from '../../app/auth';
import { LoginPage, RESEND_SECONDS } from './LoginPage';

const USER = { id: 'u-1', email: 'me@example.com' };
const fakeAuth = (overrides: Partial<AuthClient> = {}): AuthClient => ({
  currentUser: vi.fn(async () => null),
  sendCode: vi.fn(async () => {}),
  verifyCode: vi.fn(async () => USER),
  signOut: vi.fn(async () => {}),
  ...overrides,
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const typeEmail = (value: string) => fireEvent.change(screen.getByLabelText('Email'), { target: { value } });
const click = async (name: string) => {
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name }));
  });
};

describe('login page', () => {
  it('sends a code to the email and asks for it', async () => {
    const auth = fakeAuth();
    render(<LoginPage auth={auth} onSignedIn={() => {}} />);
    typeEmail(' me@example.com ');
    await click('Send code');
    expect(auth.sendCode).toHaveBeenCalledWith('me@example.com');
    expect(screen.getByText('Code sent to me@example.com')).toBeTruthy();
  });

  it('checks the email before sending', async () => {
    const auth = fakeAuth();
    render(<LoginPage auth={auth} onSignedIn={() => {}} />);
    typeEmail('me@');
    await click('Send code');
    expect(screen.getByText("That email address doesn't look right")).toBeTruthy();
    expect(auth.sendCode).not.toHaveBeenCalled();
  });

  it('signs in with the 6-digit code', async () => {
    const auth = fakeAuth();
    const onSignedIn = vi.fn();
    render(<LoginPage auth={auth} onSignedIn={onSignedIn} />);
    typeEmail('me@example.com');
    await click('Send code');
    fireEvent.change(screen.getByLabelText('Code'), { target: { value: '12a3456' } });
    expect((screen.getByLabelText('Code') as HTMLInputElement).value).toBe('123456');
    await click('Sign in');
    expect(auth.verifyCode).toHaveBeenCalledWith('me@example.com', '123456');
    expect(onSignedIn).toHaveBeenCalledWith(USER);
  });

  it('asks for the whole code', async () => {
    const auth = fakeAuth();
    render(<LoginPage auth={auth} onSignedIn={() => {}} />);
    typeEmail('me@example.com');
    await click('Send code');
    fireEvent.change(screen.getByLabelText('Code'), { target: { value: '123' } });
    await click('Sign in');
    expect(screen.getByText('Enter the full code from the email')).toBeTruthy();
    expect(auth.verifyCode).not.toHaveBeenCalled();
  });

  // Supabase codes can be set to 6–10 digits (8 by default for new projects); a change in length mustn't block sign-in
  it('accepts the longer codes Supabase can send', async () => {
    const auth = fakeAuth();
    render(<LoginPage auth={auth} onSignedIn={() => {}} />);
    typeEmail('me@example.com');
    await click('Send code');
    fireEvent.change(screen.getByLabelText('Code'), { target: { value: '12345678' } });
    expect((screen.getByLabelText('Code') as HTMLInputElement).value).toBe('12345678');
    await click('Sign in');
    expect(auth.verifyCode).toHaveBeenCalledWith('me@example.com', '12345678');
    fireEvent.change(screen.getByLabelText('Code'), { target: { value: '123456789012' } });
    expect((screen.getByLabelText('Code') as HTMLInputElement).value).toBe('1234567890');
  });

  it('says what went wrong in plain words', async () => {
    const auth = fakeAuth({
      sendCode: vi.fn(async () => {
        throw new AuthError('rate_limited', 'x');
      }),
    });
    render(<LoginPage auth={auth} onSignedIn={() => {}} />);
    typeEmail('me@example.com');
    await click('Send code');
    expect(screen.getByText('Too many requests. Try again in a while.')).toBeTruthy();

    cleanup();
    const wrong = fakeAuth({
      verifyCode: vi.fn(async () => {
        throw new AuthError('bad_code', 'x');
      }),
    });
    render(<LoginPage auth={wrong} onSignedIn={() => {}} />);
    typeEmail('me@example.com');
    await click('Send code');
    fireEvent.change(screen.getByLabelText('Code'), { target: { value: '000000' } });
    await click('Sign in');
    expect(screen.getByText('The code is wrong or has expired')).toBeTruthy();
    expect(screen.getByLabelText('Code')).toBeTruthy();
  });

  it('waits a minute before sending the code again', async () => {
    vi.useFakeTimers();
    const auth = fakeAuth();
    render(<LoginPage auth={auth} onSignedIn={() => {}} />);
    typeEmail('me@example.com');
    await click('Send code');
    const resend = () => screen.getByRole('button', { name: /Resend/ }) as HTMLButtonElement;
    expect(resend().textContent).toBe(`Resend (${RESEND_SECONDS}s)`);
    expect(resend().disabled).toBe(true);
    for (let i = 0; i < RESEND_SECONDS; i++) {
      await act(async () => {
        vi.advanceTimersByTime(1000);
      });
    }
    expect(resend().textContent).toBe('Resend');
    await click('Resend');
    expect(auth.sendCode).toHaveBeenCalledTimes(2);
  });

  it('goes back to change the email', async () => {
    render(<LoginPage auth={fakeAuth()} onSignedIn={() => {}} />);
    typeEmail('me@example.com');
    await click('Send code');
    await click('Use a different email');
    expect(screen.getByLabelText('Email')).toBeTruthy();
  });

  it('speaks Chinese when the interface is in Chinese', async () => {
    useAppStore.setState({ locale: 'zh' });
    try {
      render(<LoginPage auth={fakeAuth()} onSignedIn={() => {}} />);
      expect(screen.getByRole('heading', { name: 'AI 投资管理器' })).toBeTruthy();
      expect(screen.getByRole('button', { name: '发送验证码' })).toBeTruthy();
    } finally {
      useAppStore.setState({ locale: 'en' });
    }
  });
});
