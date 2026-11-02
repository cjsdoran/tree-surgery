import { STEPS } from '../steps.js';

export function StepBar({ current }) {
  return (
    <nav aria-label="Progress">
      <ol className="steps">
        {STEPS.map((step, i) => (
          <li key={step.id} aria-current={step.id === current ? 'step' : undefined}>
            {i + 1}. {step.label}
            {step.id === current && <span className="visually-hidden"> (current step)</span>}
          </li>
        ))}
      </ol>
    </nav>
  );
}
