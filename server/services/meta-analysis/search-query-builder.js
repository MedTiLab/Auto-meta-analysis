function normalizeTerm(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function containsCjk(value) {
  return /[\u3400-\u9fff]/.test(String(value || ''));
}

function quotePhrase(value) {
  const term = normalizeTerm(value);
  if (!term) return null;
  return term.includes(' ') ? `"${term}"` : term;
}

function block(label, terms) {
  const cleanTerms = terms.map((term) => normalizeTerm(term)).filter(Boolean);
  return {
    label,
    terms: cleanTerms,
    query: cleanTerms.length > 0 ? `(${cleanTerms.join(' OR ')})` : '',
  };
}

export function buildPubMedQuery({ disease, biomarker, reviewType = '' } = {}) {
  const diseaseTerm = quotePhrase(disease);
  const biomarkerTerm = quotePhrase(biomarker);
  const normalizedReviewType = normalizeTerm(reviewType).toLowerCase();
  const warnings = [];

  if (containsCjk(disease) || containsCjk(biomarker)) {
    warnings.push('PubMed/MEDLINE is the default English-source route. Provide English terms for PubMed, or explicitly choose the Chinese/CNKI route.');
  }

  const conceptBlocks = [
    block('disease', [
      diseaseTerm,
      diseaseTerm ? `${diseaseTerm}[Title/Abstract]` : '',
    ]),
    block('biomarker', [
      biomarkerTerm,
      biomarkerTerm ? `${biomarkerTerm}[Title/Abstract]` : '',
    ]),
  ].filter((item) => item.query);

  let endpointLabel = '';
  let endpointTerms = [];
  if (normalizedReviewType === 'prognostic') {
    endpointLabel = 'prognosis';
    endpointTerms = [
        'prognosis',
        'survival',
        '"overall survival"',
        '"disease-free survival"',
        '"progression-free survival"',
        '"hazard ratio"',
        'HR',
      ];
  } else if (normalizedReviewType === 'diagnostic') {
    endpointLabel = 'diagnostic accuracy';
    endpointTerms = [
        'diagnosis',
        'diagnostic',
        'sensitivity',
        'specificity',
        'ROC',
        'AUC',
        '"receiver operating characteristic"',
      ];
  }

  if (endpointTerms.length > 0) {
    conceptBlocks.push(block(endpointLabel, endpointTerms));
  }

  return {
    databaseName: 'pubmed',
    sourceId: 'pubmed',
    languageScope: 'english',
    ownerSkills: ['pubmed-search-strategy', 'pubmed-database'],
    pubmed: conceptBlocks.map((item) => item.query).filter(Boolean).join(' AND '),
    conceptBlocks,
    warnings,
  };
}
