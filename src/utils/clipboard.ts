const copyWithLegacyExecCommand = (text: string): boolean => {
  if (typeof document === 'undefined' || !document.body) {
    return false;
  }

  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.setAttribute('readonly', '');
  textarea.style.position = 'fixed';
  textarea.style.opacity = '0';
  textarea.style.left = '-9999px';
  textarea.style.top = '0';

  document.body.appendChild(textarea);
  textarea.focus();
  textarea.select();
  textarea.setSelectionRange(0, text.length);

  try {
    return document.execCommand('copy');
  } catch {
    return false;
  } finally {
    document.body.removeChild(textarea);
  }
};

export const copyTextToClipboard = async (text: string): Promise<boolean> => {
  if (typeof text !== 'string') {
    return false;
  }

  if (typeof window !== 'undefined' && window.medautodataDesktop?.writeClipboardText) {
    try {
      await window.medautodataDesktop.writeClipboardText(text);
      return true;
    } catch {
      // Fall through to browser clipboard methods.
    }
  }

  if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // Fall through when permissions, context, or browser limits reject writeText.
    }
  }

  return copyWithLegacyExecCommand(text);
};
