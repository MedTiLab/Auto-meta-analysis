import path from 'path';

function normalizeMimeExtension(mimeType) {
  const raw = String(mimeType || '').trim().toLowerCase();
  if (!raw.includes('/')) {
    return 'bin';
  }

  const subtype = raw.split('/')[1] || 'bin';
  if (subtype === 'svg+xml') {
    return 'svg';
  }

  return subtype.replace(/[^a-z0-9]+/g, '_') || 'bin';
}

export function buildTempAttachmentFilename(index, originalName, mimeType) {
  const ext = normalizeMimeExtension(mimeType);
  const sanitizedOriginal = String(originalName || '')
    .replace(/[^a-zA-Z0-9._-]/g, '_')
    .replace(/^\.+/, '')
    .trim();

  if (sanitizedOriginal) {
    return `${index + 1}_${sanitizedOriginal}`;
  }

  return `image_${index}.${ext}`;
}

export function toPortableAtPath(filePath, workingDir, pathApi = path) {
  const baseDir = workingDir || process.cwd();
  const relativePath = pathApi.relative(baseDir, filePath);
  return `@${relativePath.split(pathApi.sep).join('/')}`;
}
