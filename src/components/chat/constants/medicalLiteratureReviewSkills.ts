// Keep medical literature review defaults intentionally small:
// one orchestrator, one primary database, one traceability pass,
// and one citation verification pass. Escalate only when the core
// chain leaves a concrete evidence gap.
export const MEDICAL_LITERATURE_REVIEW_DEFAULT_SKILLS = [
  'literature-review',
  'pubmed-database',
  'real-literature-trace',
  'citation-management',
] as const;

export const MEDICAL_LITERATURE_REVIEW_SUPPORT_SKILLS = [
  'research-lookup',
  'inno-deep-research',
] as const;

export const MEDICAL_LITERATURE_REVIEW_SHORTCUT_SKILLS = [
  ...MEDICAL_LITERATURE_REVIEW_DEFAULT_SKILLS,
  ...MEDICAL_LITERATURE_REVIEW_SUPPORT_SKILLS,
] as const;
