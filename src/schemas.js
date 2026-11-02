// The schema validator (ajv and the compiled schemas) is the largest library in the app, and the
// first screens never need it. The browser loads it on first use; the functions import
// shared/schemaCheck.js directly.
let pending = null;

/** @returns {Promise<{ ok: boolean, errors: string[] }>} */
export async function checkSchema(name, data) {
  pending ??= import('../shared/schemaCheck.js');
  return (await pending).checkSchema(name, data);
}
