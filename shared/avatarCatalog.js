export const USER_AVATAR_CATEGORIES = [
  { id: 'medical' },
  { id: 'research' },
  { id: 'data' },
  { id: 'nature' },
  { id: 'abstract' },
  { id: 'classic' },
];

export const USER_AVATAR_PALETTES = [
  { background: '#f8fafc', primary: '#0f766e', secondary: '#64748b', accent: '#94a3b8', foreground: '#0f172a' },
  { background: '#f1f5f9', primary: '#0d9488', secondary: '#475569', accent: '#cbd5e1', foreground: '#111827' },
  { background: '#f0fdfa', primary: '#0f766e', secondary: '#4b5563', accent: '#99f6e4', foreground: '#134e4a' },
  { background: '#ecfdf5', primary: '#047857', secondary: '#64748b', accent: '#bbf7d0', foreground: '#064e3b' },
  { background: '#f7fee7', primary: '#3f6212', secondary: '#52525b', accent: '#d9f99d', foreground: '#1f2937' },
  { background: '#f8fafc', primary: '#334155', secondary: '#0f766e', accent: '#e2e8f0', foreground: '#0f172a' },
  { background: '#f5f5f4', primary: '#44403c', secondary: '#0f766e', accent: '#d6d3d1', foreground: '#1c1917' },
  { background: '#eef2ff', primary: '#475569', secondary: '#0d9488', accent: '#c7d2fe', foreground: '#1e293b' },
  { background: '#f0f9ff', primary: '#0369a1', secondary: '#64748b', accent: '#bae6fd', foreground: '#0c4a6e' },
  { background: '#fdf4ff', primary: '#64748b', secondary: '#0f766e', accent: '#f5d0fe', foreground: '#334155' },
  { background: '#fff7ed', primary: '#57534e', secondary: '#0f766e', accent: '#fed7aa', foreground: '#292524' },
  { background: '#fafafa', primary: '#525252', secondary: '#0d9488', accent: '#d4d4d4', foreground: '#171717' },
];

const USER_AVATAR_GLYPHS = [
  'pulse',
  'cross',
  'dna',
  'flask',
  'book',
  'node',
  'chart',
  'spark',
  'leaf',
  'drop',
  'pill',
  'orbit',
];

const USER_AVATAR_PATTERNS = ['dots', 'arc', 'grid', 'wave'];

export const USER_AVATAR_CATALOG = Array.from({ length: 48 }, (_, index) => {
  const ordinal = String(index + 1).padStart(2, '0');
  return {
    id: `avatar-${ordinal}`,
    label: `Avatar ${ordinal}`,
    category: USER_AVATAR_CATEGORIES[index % USER_AVATAR_CATEGORIES.length].id,
    glyph: USER_AVATAR_GLYPHS[index % USER_AVATAR_GLYPHS.length],
    paletteIndex: index % USER_AVATAR_PALETTES.length,
    pattern: USER_AVATAR_PATTERNS[Math.floor(index / USER_AVATAR_GLYPHS.length) % USER_AVATAR_PATTERNS.length],
  };
});

export const DEFAULT_USER_AVATAR_ID = USER_AVATAR_CATALOG[0].id;
export const USER_AVATAR_BY_ID = new Map(USER_AVATAR_CATALOG.map((avatar) => [avatar.id, avatar]));

export function hashStringToNumber(value = '') {
  const input = String(value || 'medautodata-user');
  let hash = 2166136261;

  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }

  return hash >>> 0;
}

export function getDefaultAvatarId(seed = '') {
  const index = hashStringToNumber(seed) % USER_AVATAR_CATALOG.length;
  return USER_AVATAR_CATALOG[index]?.id || DEFAULT_USER_AVATAR_ID;
}

export function isValidAvatarId(avatarId) {
  return typeof avatarId === 'string' && USER_AVATAR_BY_ID.has(avatarId);
}

export function getAvatarById(avatarId, seed = '') {
  if (isValidAvatarId(avatarId)) {
    return USER_AVATAR_BY_ID.get(avatarId);
  }

  return USER_AVATAR_BY_ID.get(getDefaultAvatarId(seed)) || USER_AVATAR_CATALOG[0];
}

export function getAvatarPalette(avatar) {
  return USER_AVATAR_PALETTES[avatar?.paletteIndex % USER_AVATAR_PALETTES.length] || USER_AVATAR_PALETTES[0];
}
