// Limits and app settings shared by the browser and the functions.
// Values live in config/app.json so Chris can change them without touching code.
import appConfig from '../config/app.json' with { type: 'json' };

export const config = appConfig;
export const limits = appConfig.limits;

export const MESSAGES = {
  badAccessCode: "That access code isn't recognised. Check Canvas.",
  tooLarge: 'That request is too large. Shorten the context or the tree and try again.',
  badRequest: 'Something went wrong sending your work. Try again.',
  notImplemented: 'This step is not available yet.',
  serverMisconfigured: 'Tree Surgery is not set up correctly. Tell your instructor.',
};

// Footer disclaimer. Before a course is chosen, name both courses.
export function footerText(course) {
  const label = course && appConfig.courses.includes(course) ? course : appConfig.courses.join(' / ');
  return appConfig.footer.replace('{COURSE}', label);
}

/** The student's first name, for greetings: "Hi Chris,". Before setup, just "Hi,". */
export function greeting(name) {
  const first = String(name ?? '').trim().split(/\s+/)[0];
  return first ? `Hi ${first},` : 'Hi,';
}
