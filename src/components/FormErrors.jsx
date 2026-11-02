// Error summary at the top of a form, linking to each field, plus inline field errors.
// Errors are labelled in text ("Error:"), not shown by colour alone.

export function ErrorSummary({ errors }) {
  if (!errors.length) return null;
  return (
    <div className="error-summary" role="alert" aria-labelledby="error-summary-heading">
      <h3 id="error-summary-heading">Fix {errors.length === 1 ? 'this' : `these ${errors.length} things`} to continue</h3>
      <ul>
        {errors.map((e) => (
          <li key={e.field + e.message}>
            <a href={`#${e.field}`} onClick={(ev) => focusField(ev, e.field)}>{e.message}</a>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function FieldError({ id, message }) {
  if (!message) return null;
  return (
    <p className="field-error" id={id}>
      <strong>Error:</strong> {message}
    </p>
  );
}

function focusField(ev, id) {
  const el = document.getElementById(id);
  if (!el) return;
  ev.preventDefault();
  el.focus();
  el.scrollIntoView?.({ block: 'center' });
}
