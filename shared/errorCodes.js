// Error codes the student can quote to Chris (spec §12.1, from QT D15, D19). Shared by the
// browser, which shows them, and the functions, which log them. Never pass file content to any
// of these.

export const CODES = {
  wrongType: 'TS-U01',
  oldFormat: 'TS-U02',
  tooBig: 'TS-U03',
  tooManyPages: 'TS-U04',
  noText: 'TS-U05',
  caseBlocked: 'TS-U06',
  unreadable: 'TS-U07',
  password: 'TS-U08',
  noTree: 'TS-U09',
  serverMisconfigured: 'TS-S01',
  badAccessCode: 'TS-S02',
  timeout: 'TS-S03',
  formatFailed: 'TS-S04',
  other: 'TS-S05',
};

/** "Message. (Error code: TS-U07 InvalidPDFException)" */
export function withCode(message, code, detail) {
  if (!code) return message;
  return `${message} (Error code: ${code}${detail ? ` ${detail}` : ''})`;
}

/** The code for a failed call to a function, from its HTTP status and `error` field. */
export function codeForServerError({ status, error } = {}) {
  if (error === 'server_misconfigured') return CODES.serverMisconfigured;
  if (status === 401 || error === 'bad_access_code') return CODES.badAccessCode;
  if (error === 'timeout') return CODES.timeout;
  if (error === 'case_blocked') return CODES.caseBlocked;
  return CODES.other;
}

/** The code for a function log line's outcome (an HTTP status or a model outcome); null on success. */
export function codeForOutcome(outcome) {
  if (outcome === 'ok' || outcome === 200 || outcome === 204) return null;
  if (outcome === 'no_api_key' || outcome === 500) return CODES.serverMisconfigured;
  if (outcome === 401) return CODES.badAccessCode;
  if (outcome === 'timeout' || outcome === 504) return CODES.timeout;
  if (outcome === 422) return CODES.caseBlocked;
  if (outcome === 'invalid') return CODES.formatFailed;
  return CODES.other;
}
