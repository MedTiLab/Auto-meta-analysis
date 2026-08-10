import { registerValidator } from './evidence-ledger.js';

export function extractionProvenanceValidator(artifact) {
  const rows = (artifact.payload && artifact.payload.rows) || [];
  const errors = [];
  rows.forEach((row, index) => {
    const source = row && row.source;
    if (!source || !source.parsedDocumentId || !source.locator) {
      errors.push({
        code: 'EXTRACTION_PROVENANCE_MISSING',
        message: `row ${index} is missing source.parsedDocumentId/locator`,
      });
    }
  });
  return { passed: errors.length === 0, errors };
}

export function analysisPlanAdherenceValidator(artifact) {
  const payload = artifact.payload || {};
  const plan = payload.analysisPlan || {};
  const errors = [];

  if (!payload.effectMeasure || payload.effectMeasure !== plan.effectMeasure) {
    errors.push({
      code: 'ANALYSIS_PLAN_DEVIATION',
      message: `effectMeasure "${payload.effectMeasure}" != pre-registered "${plan.effectMeasure}"`,
    });
  }
  if (!payload.model || payload.model !== plan.model) {
    errors.push({
      code: 'ANALYSIS_PLAN_DEVIATION',
      message: `model "${payload.model}" != pre-registered "${plan.model}"`,
    });
  }

  const het = payload.heterogeneity || {};
  if (het.i2 === undefined || het.tau2 === undefined) {
    errors.push({
      code: 'HETEROGENEITY_NOT_REPORTED',
      message: 'heterogeneity.i2 and heterogeneity.tau2 are required',
    });
  }

  const datasetRows = (payload.dataset && payload.dataset.rows) || [];
  const pooled = payload.pooledEstimates || [];
  if (pooled.length > 0 && datasetRows.length === 0) {
    errors.push({
      code: 'POOLED_ESTIMATE_WITHOUT_DATASET',
      message: 'pooled estimates present but dataset has no rows',
    });
  }

  return { passed: errors.length === 0, errors };
}

export function registerCoreEvidenceValidators() {
  registerValidator('ExtractionSet', 'extraction-provenance', extractionProvenanceValidator);
  registerValidator('AnalysisRun', 'analysis-plan-adherence', analysisPlanAdherenceValidator);
}
