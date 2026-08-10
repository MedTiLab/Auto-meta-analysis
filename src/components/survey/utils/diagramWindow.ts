const DIAGRAM_STORAGE_PREFIX = 'med-help-survey-diagram:';
const LEGACY_DIAGRAM_STORAGE_PREFIXES = ['dr-claw-survey-diagram:', 'vibelab-survey-diagram:'];

export function saveSurveyDiagramSource(source: string) {
  const diagramId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  localStorage.setItem(`${DIAGRAM_STORAGE_PREFIX}${diagramId}`, source);
  LEGACY_DIAGRAM_STORAGE_PREFIXES.forEach((prefix) => {
    localStorage.removeItem(`${prefix}${diagramId}`);
  });
  return diagramId;
}

export function loadSurveyDiagramSource(diagramId: string) {
  const currentKey = `${DIAGRAM_STORAGE_PREFIX}${diagramId}`;
  const currentValue = localStorage.getItem(currentKey);
  if (currentValue !== null) {
    return currentValue;
  }

  for (const legacyPrefix of LEGACY_DIAGRAM_STORAGE_PREFIXES) {
    const legacyKey = `${legacyPrefix}${diagramId}`;
    const legacyValue = localStorage.getItem(legacyKey);
    if (legacyValue === null) continue;
    localStorage.setItem(currentKey, legacyValue);
    localStorage.removeItem(legacyKey);
    return legacyValue;
  }
  return null;
}
