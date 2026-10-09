// The login page: a 6-digit code sent by email, no password.
import type { AuthErrorKind } from '../../app/auth';

export const en = {
  intro: 'Sign in with a code sent to your email. No password needed.',
  email: 'Email',
  sendCode: 'Send code',
  sending: 'Sending…',
  codeSentTo: (email: string) => `Code sent to ${email}`,
  code: 'Code',
  signIn: 'Sign in',
  signingIn: 'Signing in…',
  resend: 'Resend',
  resendIn: (seconds: number) => `Resend (${seconds}s)`,
  otherEmail: 'Use a different email',
  incompleteCode: 'Enter the full code from the email',
  errors: {
    bad_email: "That email address doesn't look right",
    rate_limited: 'Too many requests. Try again in a while.',
    bad_code: 'The code is wrong or has expired',
    network: "Can't reach the server. Check your connection and try again.",
    send_failed: "The code email wasn't sent. Try again later.",
    server: 'Something went wrong on the server. Try again later.',
    unknown: "That didn't work. Try again later.",
  } as Record<AuthErrorKind, string>,
};

export const zh: typeof en = {
  intro: '用邮箱收验证码登录，不用设密码。',
  email: '邮箱',
  sendCode: '发送验证码',
  sending: '正在发送…',
  codeSentTo: (email) => `验证码已发到 ${email}`,
  code: '验证码',
  signIn: '登录',
  signingIn: '正在登录…',
  resend: '重新发送',
  resendIn: (seconds) => `重新发送（${seconds} 秒）`,
  otherEmail: '换个邮箱',
  incompleteCode: '请输入邮件里的完整验证码',
  errors: {
    bad_email: '邮箱格式不对',
    rate_limited: '发送太频繁，请过一会儿再试',
    bad_code: '验证码不对或已过期',
    network: '连不上服务器，检查一下网络再试',
    send_failed: '验证码邮件没有发出去，请稍后再试',
    server: '服务器出错了，请稍后再试',
    unknown: '没有成功，请稍后再试',
  },
};
