/**
 * Lightweight BibTeX parser — no external dependencies.
 *
 * Handles:
 *  - @type{key, field = {value}, ...}
 *  - @type{key, field = "value", ...}
 *  - Nested braces in values
 *  - Basic LaTeX accent commands (\'{e} → é, etc.)
 *  - Concatenated string fields (field = {a} # {b})
 */

// Common LaTeX accent → unicode mappings
const LATEX_ACCENTS = {
  "`a": "à", "'a": "á", "^a": "â", "~a": "ã", '"a': "ä",
  "`e": "è", "'e": "é", "^e": "ê", '"e': "ë",
  "`i": "ì", "'i": "í", "^i": "î", '"i': "ï",
  "`o": "ò", "'o": "ó", "^o": "ô", "~o": "õ", '"o': "ö",
  "`u": "ù", "'u": "ú", "^u": "û", '"u': "ü",
  "`A": "À", "'A": "Á", "^A": "Â", "~A": "Ã", '"A': "Ä",
  "`E": "È", "'E": "É", "^E": "Ê", '"E': "Ë",
  "`I": "Ì", "'I": "Í", "^I": "Î", '"I': "Ï",
  "`O": "Ò", "'O": "Ó", "^O": "Ô", "~O": "Õ", '"O': "Ö",
  "`U": "Ù", "'U": "Ú", "^U": "Û", '"U': "Ü",
  "~n": "ñ", "~N": "Ñ", "cc": "ç", "cC": "Ç",
};

function cleanLatex(str) {
  if (!str) return str;
  // \'{e}  or  \'e  →  lookup
  let result = str.replace(/\\([`'^"~c])\{([a-zA-Z])\}/g, (_, accent, char) => {
    return LATEX_ACCENTS[accent + char] || char;
  });
  result = result.replace(/\\([`'^"~c])([a-zA-Z])/g, (_, accent, char) => {
    return LATEX_ACCENTS[accent + char] || char;
  });
  // Strip remaining braces
  result = result.replace(/[{}]/g, '');
  // Common TeX commands
  result = result.replace(/\\textit\s*/g, '');
  result = result.replace(/\\textbf\s*/g, '');
  result = result.replace(/\\emph\s*/g, '');
  result = result.replace(/\\\\/g, ' ');
  result = result.replace(/\\&/g, '&');
  result = result.replace(/\\%/g, '%');
  result = result.replace(/~/g, ' ');
  return result.trim();
}

/**
 * Parse a BibTeX string and return an array of entry objects.
 */
export function parseBibtex(bibtexString) {
  const entries = [];
  // Match each @type{...} block
  const entryRegex = /@(\w+)\s*\{/g;
  let match;

  while ((match = entryRegex.exec(bibtexString)) !== null) {
    const entryType = match[1].toLowerCase();
    if (entryType === 'comment' || entryType === 'preamble' || entryType === 'string') continue;

    const startIdx = match.index + match[0].length;
    // Find the matching closing brace (handle nesting)
    let depth = 1;
    let i = startIdx;
    while (i < bibtexString.length && depth > 0) {
      if (bibtexString[i] === '{') depth++;
      else if (bibtexString[i] === '}') depth--;
      i++;
    }
    const body = bibtexString.slice(startIdx, i - 1);

    // First token is the citation key
    const commaIdx = body.indexOf(',');
    if (commaIdx === -1) continue;
    const citationKey = body.slice(0, commaIdx).trim();
    const fieldsStr = body.slice(commaIdx + 1);

    const fields = parseFields(fieldsStr);
    entries.push({ entryType, citationKey, fields });
  }

  return entries.map(mapToReference);
}

function parseFields(str) {
  const fields = {};
  // State machine to parse: fieldname = {value} or "value"
  let i = 0;
  const len = str.length;

  while (i < len) {
    // Skip whitespace and commas
    while (i < len && /[\s,]/.test(str[i])) i++;
    if (i >= len) break;

    // Read field name
    let nameStart = i;
    while (i < len && str[i] !== '=' && !/[\s,{}]/.test(str[i])) i++;
    const fieldName = str.slice(nameStart, i).trim().toLowerCase();
    if (!fieldName) { i++; continue; }

    // Skip to =
    while (i < len && str[i] !== '=') i++;
    if (i >= len) break;
    i++; // skip =

    // Skip whitespace
    while (i < len && /\s/.test(str[i])) i++;
    if (i >= len) break;

    // Read value — braced, quoted, or bare number
    let value = '';
    if (str[i] === '{') {
      i++; // skip opening brace
      let depth = 1;
      let vStart = i;
      while (i < len && depth > 0) {
        if (str[i] === '{') depth++;
        else if (str[i] === '}') depth--;
        if (depth > 0) i++;
      }
      value = str.slice(vStart, i);
      i++; // skip closing brace
    } else if (str[i] === '"') {
      i++; // skip opening quote
      let vStart = i;
      while (i < len && !(str[i] === '"' && str[i - 1] !== '\\')) i++;
      value = str.slice(vStart, i).replace(/\\"/g, '"');
      i++; // skip closing quote
    } else {
      // Bare value (number or string reference)
      let vStart = i;
      while (i < len && str[i] !== ',' && str[i] !== '}' && !/\s/.test(str[i])) i++;
      value = str.slice(vStart, i);
    }

    // Handle # concatenation
    while (i < len) {
      // skip whitespace
      let j = i;
      while (j < len && /\s/.test(str[j])) j++;
      if (str[j] !== '#') break;
      j++; // skip #
      while (j < len && /\s/.test(str[j])) j++;
      i = j;
      // Read next part
      if (str[i] === '{') {
        i++;
        let depth = 1;
        let vStart = i;
        while (i < len && depth > 0) {
          if (str[i] === '{') depth++;
          else if (str[i] === '}') depth--;
          if (depth > 0) i++;
        }
        value += str.slice(vStart, i);
        i++;
      } else if (str[i] === '"') {
        i++;
        let vStart = i;
        while (i < len && !(str[i] === '"' && str[i - 1] !== '\\')) i++;
        value += str.slice(vStart, i).replace(/\\"/g, '"');
        i++;
      }
    }

    if (fieldName) {
      fields[fieldName] = cleanLatex(value);
    }
  }

  return fields;
}

function parseAuthors(authorStr) {
  if (!authorStr) return [];
  return authorStr.split(/\s+and\s+/i).map((a) => {
    const parts = a.trim().split(',').map((s) => s.trim());
    if (parts.length >= 2) {
      return { family: parts[0], given: parts.slice(1).join(' ') };
    }
    const words = a.trim().split(/\s+/);
    if (words.length === 1) return { family: words[0], given: '' };
    return { family: words[words.length - 1], given: words.slice(0, -1).join(' ') };
  });
}

function mapToReference(entry) {
  const f = entry.fields;
  const yearStr = f.year || '';
  const year = parseInt(yearStr, 10) || null;

  return {
    citationKey: entry.citationKey,
    title: f.title || 'Untitled',
    authors: parseAuthors(f.author),
    year,
    abstract: f.abstract || null,
    doi: f.doi || null,
    url: f.url || null,
    journal: f.journal || f.journalname || f.booktitle || null,
    itemType: entry.entryType || 'article',
    keywords: f.keywords ? f.keywords.split(/[,;]/).map((k) => k.trim()).filter(Boolean) : [],
    source: 'bibtex',
  };
}
