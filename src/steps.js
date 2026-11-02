// The eight steps of a Tree Surgery run (spec §1).
export const STEPS = [
  { id: 'briefing', label: 'Briefing' },
  { id: 'setup', label: 'Setup' },
  { id: 'context', label: 'Context' },
  { id: 'key-question', label: 'Key question' },
  { id: 'tree', label: 'Tree' },
  { id: 'feedback', label: 'Feedback' },
  { id: 'revision', label: 'Revision' },
  { id: 'record', label: 'Record' },
];

export function stepIndex(id) {
  return STEPS.findIndex((s) => s.id === id);
}
