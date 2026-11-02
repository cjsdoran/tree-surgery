// Setup rules (TS-1, spec §3): one student.
import { config, limits } from '../../shared/limits.js';

export function emptySetup() {
  return { accessCode: '', name: '', studentId: '', course: '', client: '' };
}

/**
 * @returns {{ ok: boolean, errors: { field: string, message: string }[] }}
 * Field keys match the input ids, so the error summary can link to them.
 */
export function validateSetup(values) {
  const errors = [];
  const add = (field, message) => errors.push({ field, message });
  const text = (v) => String(v ?? '').trim();
  const required = (key, field, missing, label, max) => {
    const v = text(values[key]);
    if (!v) add(field, missing);
    else if (v.length > max) add(field, `${label} must be ${max} characters or fewer.`);
  };

  if (!text(values.accessCode)) add('setup-accessCode', 'Enter the access code from Canvas.');
  required('name', 'setup-name', 'Enter your name.', 'Your name', limits.nameMaxChars);
  required('studentId', 'setup-studentId', 'Enter your student ID.', 'Student ID', limits.studentIdMaxChars);
  if (!config.courses.includes(values.course)) add('setup-course', 'Choose your course.');
  required('client', 'setup-client', 'Enter the client or project name.', 'Client or project name', limits.clientMaxChars);

  return { ok: errors.length === 0, errors };
}

export function cleanSetup(values) {
  return {
    accessCode: values.accessCode.trim(),
    name: values.name.trim().replace(/\s+/g, ' '),
    studentId: values.studentId.trim(),
    course: values.course,
    client: values.client.trim(),
  };
}
