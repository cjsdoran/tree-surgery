import { footerText } from '../../shared/limits.js';

export function Footer({ course }) {
  return (
    <footer className="app-footer">
      <p>{footerText(course)}</p>
    </footer>
  );
}
