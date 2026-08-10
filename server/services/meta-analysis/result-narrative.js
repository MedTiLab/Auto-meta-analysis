export function buildMethodsDraft(metaProject = {}) {
  const title = metaProject.title || 'this diagnostic accuracy meta-analysis';
  const disease = metaProject.disease || 'the target disease';
  const biomarker = metaProject.biomarker || 'the index biomarker';
  const referenceStandard = metaProject.reference_standard || 'the reference standard';

  return [
    `## Methods`,
    '',
    `We designed ${title} as a project-level diagnostic accuracy meta-analysis. Eligible studies evaluated ${biomarker} for ${disease} using ${referenceStandard}.`,
    '',
    'Records were managed through the shared reference library and linked to the active project. PDFs were resolved only from legal sources, including existing Zotero attachments, user uploads, PubMed Central, Europe PMC, Unpaywall open-access PDFs, and publisher open-access locations.',
    '',
    'Parsed document outputs and extraction candidates were retained with page, table, parser, confidence, and review status provenance. Only rows with `review_status = confirmed` were eligible for statistical analysis.',
  ].join('\n');
}

export function buildResultsDraft({ metaProject = {}, overview = {}, latestRun = null } = {}) {
  const references = overview?.counts?.references?.total || 0;
  const confirmed = overview?.counts?.extractions?.confirmed || 0;
  const completedRuns = overview?.counts?.analysisRuns?.completed || 0;
  const title = metaProject.title || 'The diagnostic meta-analysis';

  const lines = [
    '## Results',
    '',
    `${title} currently includes ${references} project-linked reference(s). ${confirmed} confirmed diagnostic extraction row(s) are available for dataset export.`,
    '',
    `${completedRuns} diagnostic analysis run(s) have completed. Analysis outputs are stored with the input CSV, R script path, machine-readable JSON, figures, stdout, stderr, and timestamps.`,
  ];

  if (latestRun?.output_json) {
    lines.push('', `The latest run included ${latestRun.output_json.n_studies || 0} study rows.`);
  }

  return lines.join('\n');
}
