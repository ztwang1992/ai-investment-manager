// Code formats the quotes API (worker/) accepts, shared by the app and the Worker:
// US stocks are uppercase letters and digits, optionally with a dot or dash (BRK.B); A-shares and mutual funds are 6 digits.

export const QUOTE_CODE = {
  us: /^[A-Z0-9][A-Z0-9.-]{0,11}$/,
  cn: /^\d{6}$/,
  fund: /^\d{6}$/,
} as const;
