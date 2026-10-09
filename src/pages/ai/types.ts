/** The result of one "Test connection" request */
export type TestOutcome =
  | { kind: 'ok'; latencyMs: number; models: string[] }
  | { kind: 'http'; status: number }
  | { kind: 'timeout' }
  | { kind: 'network' };
