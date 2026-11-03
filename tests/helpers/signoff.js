// Sign-off model replies for tests.
import { config } from '../../shared/limits.js';

export function notThereYet(overrides = {}) {
  return {
    verdict: 'not_there_yet',
    email: {
      subject: 'Re: your revised issue tree',
      opener: config.openers.notThereYet,
      improved: ['The separate cash cycle branch has gone, so working capital now sits with the trade it belongs to.'],
      stillFails: [
        'Level 1 is still cash inflow vs cash outflow under new names. It is generic and it splits every unit across two branches, so price and cost decisions for the same channel sit apart.',
        'Cash control still mixes bookkeeping and hiring, which flow through inflow and outflow; it is not independent as stated.',
      ],
      heldPoints: ['"Which segment should we focus on?" appears twice and is a diagnostic question, not an option.'],
      lesson: 'Cut first by the units that make the money, then split each unit by its own levers.',
      ps: null,
    },
    ...overrides,
  };
}

export function signedOff(overrides = {}) {
  return {
    verdict: 'signed_off',
    email: {
      subject: 'Re: your revised issue tree',
      opener: config.openers.signedOff,
      improved: [
        'Level 1 now separates jam from the café, garden, theatre and kiosk, so each business can be judged and parked on its own.',
        'Organisation and governance has its own branch, scoped beyond structure, with the founder and the books inside it.',
      ],
      stillFails: [],
      heldPoints: [
        '"Rent", "Utilities" and "Marketing" under fixed costs are bare nouns; write them as options, eg "How can PEIP cut rent?".',
        'Wholesale stops at level 2; take it down to the distributors you would add or drop.',
      ],
      lesson: 'Isolate the units first and the rest of the tree falls into place.',
      ps: 'Check "PEIP" in node 2.1: it reads "PEP".',
    },
    ...overrides,
  };
}
