export function evaluateEligibility(ref, predicates = {}) {
  const haystack = `${ref.title || ''} ${ref.abstract || ''}`.toLowerCase();
  const year = Number(ref.year);

  if (predicates.yearMin && year && year < predicates.yearMin) {
    return { decision: 'exclude', confidence: 0.95, reasons: [`year ${year} < yearMin ${predicates.yearMin}`] };
  }
  if (predicates.yearMax && year && year > predicates.yearMax) {
    return { decision: 'exclude', confidence: 0.95, reasons: [`year ${year} > yearMax ${predicates.yearMax}`] };
  }
  for (const kw of predicates.excludeKeywords || []) {
    if (haystack.includes(String(kw).toLowerCase())) {
      return { decision: 'exclude', confidence: 0.9, reasons: [`matched excludeKeyword "${kw}"`] };
    }
  }
  for (const st of predicates.studyTypesExclude || []) {
    if (haystack.includes(String(st).toLowerCase())) {
      return { decision: 'exclude', confidence: 0.85, reasons: [`matched excluded study type "${st}"`] };
    }
  }

  const allList = predicates.includeKeywordsAll || [];
  const allOk = allList.every((kw) => haystack.includes(String(kw).toLowerCase()));
  if (allList.length && !allOk) {
    return { decision: 'maybe', confidence: 0.4, reasons: ['missing one or more required includeKeywordsAll'] };
  }
  const anyList = predicates.includeKeywordsAny || [];
  const anyOk = anyList.length === 0 ? true : anyList.some((kw) => haystack.includes(String(kw).toLowerCase()));
  const typeList = predicates.studyTypesInclude || [];
  const typeOk = typeList.length === 0 ? true : typeList.some((st) => haystack.includes(String(st).toLowerCase()));

  if (anyOk && typeOk) {
    return { decision: 'include', confidence: 0.85, reasons: ['matched include criteria'] };
  }
  return { decision: 'maybe', confidence: 0.4, reasons: ['did not clearly match include criteria'] };
}
