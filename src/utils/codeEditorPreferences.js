export const CODE_EDITOR_FONT_SIZE_OPTIONS = ['10', '11', '12', '13', '14', '15', '16', '18', '20'];

export function resolveCodeEditorFontSize(value) {
  const normalized = String(value || '').trim();
  return CODE_EDITOR_FONT_SIZE_OPTIONS.includes(normalized) ? normalized : '14';
}

export function readCodeEditorFontSize() {
  if (typeof window === 'undefined') {
    return '14';
  }
  return resolveCodeEditorFontSize(window.localStorage.getItem('codeEditorFontSize'));
}

export function writeCodeEditorFontSize(value) {
  const nextFontSize = resolveCodeEditorFontSize(value);
  if (typeof window !== 'undefined') {
    window.localStorage.setItem('codeEditorFontSize', nextFontSize);
    window.dispatchEvent(new Event('codeEditorSettingsChanged'));
  }
  return nextFontSize;
}
