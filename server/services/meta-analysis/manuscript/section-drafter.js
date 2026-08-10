export function draftSection(sectionKey, context = {}) {
  const title = context.metaProject?.title || 'this diagnostic meta-analysis';
  if (sectionKey === 'introduction') {
    return [
      '## Introduction',
      '',
      `${title} addresses a diagnostic accuracy question in oncology. This draft should be reviewed and expanded with disease burden, biomarker rationale, and prior evidence before manuscript submission.`,
    ].join('\n');
  }

  if (sectionKey === 'discussion') {
    return [
      '## Discussion',
      '',
      'The discussion should interpret the confirmed diagnostic accuracy results, heterogeneity, clinical applicability, and limitations of the evidence base. This generated draft intentionally avoids unsupported claims.',
    ].join('\n');
  }

  if (sectionKey === 'conclusion') {
    return [
      '## Conclusion',
      '',
      'Conclusions should be finalized only after user authorization or named-agent review of extracted data, risk-of-bias evidence, and statistical outputs.',
    ].join('\n');
  }

  return `## ${sectionKey}\n\nDraft pending.`;
}
