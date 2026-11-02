import { MESSAGES } from '../../shared/limits.js';
import { STEPS } from '../steps.js';

// Placeholder for steps built in later milestones.
export function NotYetScreen({ step }) {
  const label = STEPS.find((s) => s.id === step)?.label ?? step;
  return (
    <section className="step-form" aria-labelledby="not-yet-heading">
      <h2 id="not-yet-heading">{label}</h2>
      <p>{MESSAGES.notImplemented}</p>
    </section>
  );
}
