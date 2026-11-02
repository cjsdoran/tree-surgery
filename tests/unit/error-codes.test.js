// T-ERR-1: error codes for server failures (spec §12.1). Upload codes are tested with the
// upload code in milestones 2 and 4.
import { describe, expect, it } from 'vitest';
import { CODES, codeForOutcome, codeForServerError, withCode } from '../../shared/errorCodes.js';

describe('T-ERR-1: codes', () => {
  it('has every code in spec §12.1', () => {
    expect(Object.values(CODES).sort()).toEqual([
      'TS-S01', 'TS-S02', 'TS-S03', 'TS-S04', 'TS-S05',
      'TS-U01', 'TS-U02', 'TS-U03', 'TS-U04', 'TS-U05', 'TS-U06', 'TS-U07', 'TS-U08', 'TS-U09',
    ]);
  });

  it('withCode adds the code, and the error name when there is one', () => {
    expect(withCode('Too long.', 'TS-U04')).toBe('Too long. (Error code: TS-U04)');
    expect(withCode("We couldn't open x.pdf.", 'TS-U07', 'InvalidPDFException')).toBe("We couldn't open x.pdf. (Error code: TS-U07 InvalidPDFException)");
    expect(withCode('Plain.', null)).toBe('Plain.');
  });

  it.each([
    [{ status: 500, error: 'server_misconfigured' }, 'TS-S01'],
    [{ status: 401, error: 'bad_access_code' }, 'TS-S02'],
    [{ status: 504, error: 'timeout' }, 'TS-S03'],
    [{ status: 200, error: 'timeout' }, 'TS-S03'],
    [{ status: 422, error: 'case_blocked' }, 'TS-U06'],
    [{ status: 502, error: 'model_error' }, 'TS-S05'],
    [{ status: 200, error: 'refusal' }, 'TS-S05'],
    [{ status: 200, error: 'truncated' }, 'TS-S05'],
    [{ status: 0, error: 'network' }, 'TS-S05'],
    [{ status: 413, error: 'too_large' }, 'TS-S05'],
  ])('%j → %s', (failure, code) => {
    expect(codeForServerError(failure)).toBe(code);
  });

  it('maps function log outcomes to codes', () => {
    expect(codeForOutcome('ok')).toBeNull();
    expect(codeForOutcome(204)).toBeNull();
    expect(codeForOutcome('no_api_key')).toBe('TS-S01');
    expect(codeForOutcome(500)).toBe('TS-S01');
    expect(codeForOutcome(401)).toBe('TS-S02');
    expect(codeForOutcome('timeout')).toBe('TS-S03');
    expect(codeForOutcome('invalid')).toBe('TS-S04');
    expect(codeForOutcome(422)).toBe('TS-U06');
    expect(codeForOutcome('model_error')).toBe('TS-S05');
  });
});
