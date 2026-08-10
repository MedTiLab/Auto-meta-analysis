/**
 * Utility functions for formatting and cleaning session content.
 */

/**
 * Strips internal [Context: ...] prefixes from message text.
 * Handles full prefixes [Context: ...] and common truncated ones like [Context: Tre...
 * @param {string} text - The message text
 * @param {boolean} returnDefaultOnEmpty - Whether to return 'New Session' if result is empty
 * @returns {string|null} - Cleaned text or null/default if empty
 */
export function stripInternalContextPrefix(text, returnDefaultOnEmpty = true) {
  if (typeof text !== 'string') return returnDefaultOnEmpty ? '' : null;
  
  let cleaned = text;
  let hasMatch = false;

  const internalCommandTagPattern = /<\/?(?:command-name|command-message|command-args|local-command-stdout)>/i;
  const skillContentPattern = /Base directory for this skill:\s*\S+/i;
  const analysisPreferencesBlockPattern = /^\s*<analysis_preferences>[\s\S]*?<\/analysis_preferences>\s*/i;
  const truncatedAnalysisPreferencesPattern = /^\s*<analysis_preferences>[\s\S]*$/i;
  const medHelpIdentityBlockPattern = /^\s*<medhelp_assistant_identity>[\s\S]*?<\/medhelp_assistant_identity>\s*/i;
  const truncatedMedHelpIdentityPattern = /^\s*<medhelp_assistant_identity>[\s\S]*$/i;
  const userPreferencesBlockPattern = /^\s*<user_preferences>[\s\S]*?<\/user_preferences>\s*/i;
  const truncatedUserPreferencesPattern = /^\s*<user_preferences>[\s\S]*$/i;
  const executionMemoryBlockPattern = /^\s*<execution_memory>[\s\S]*?<\/execution_memory>\s*/i;
  const truncatedExecutionMemoryPattern = /^\s*<execution_memory>[\s\S]*$/i;
  const researchLessonsBlockPattern = /^\s*<research_lessons>[\s\S]*?<\/research_lessons>\s*/i;
  const truncatedResearchLessonsPattern = /^\s*<research_lessons>[\s\S]*$/i;
  const skillMarkdownPattern =
    /^\s*(?:---\s*[\s\S]*?\s*---\s*)?#\s+[^\n]+\n+##\s+Overview\b[\s\S]*?##\s+When to Use This Skill\b/i;
  const fullPrefixPattern = /^\s*\[Context:[^\]]*\]\s*/i;
  const userRequestLabelPattern = /^\s*User request:\s*/i;
  const leadingInternalBlockPatterns = [
    fullPrefixPattern,
    medHelpIdentityBlockPattern,
    analysisPreferencesBlockPattern,
    userPreferencesBlockPattern,
    executionMemoryBlockPattern,
    researchLessonsBlockPattern,
  ];

  const stripLeadingInternalMarkers = () => {
    let changed = false;
    let shouldContinue = true;

    while (shouldContinue) {
      shouldContinue = false;

      for (const pattern of leadingInternalBlockPatterns) {
        if (pattern.test(cleaned)) {
          cleaned = cleaned.replace(pattern, '');
          changed = true;
          shouldContinue = true;
          break;
        }
      }

      if ((changed || hasMatch) && userRequestLabelPattern.test(cleaned)) {
        cleaned = cleaned.replace(userRequestLabelPattern, '');
        shouldContinue = true;
      }
    }

    return changed;
  };

  if (internalCommandTagPattern.test(cleaned) || skillContentPattern.test(cleaned)) {
    cleaned = cleaned
      .replace(/<command-name>[^<]*<\/command-name>/gi, '')
      .replace(/<command-message>[^<]*<\/command-message>/gi, '')
      .replace(/<command-args>[^<]*<\/command-args>/gi, '')
      .replace(/<local-command-stdout>[\s\S]*?<\/local-command-stdout>/gi, '')
      .replace(/^[❯>]\s*Base directory for this skill:\s*\S+\s*/gim, '')
      .replace(/^Base directory for this skill:\s*\S+\s*/gim, '')
      .trim();
    hasMatch = true;
  }

  if (stripLeadingInternalMarkers()) {
    hasMatch = true;
  }

  // 2. Match common truncated prefixes like "[Context: session-mode=..." or "[Context: Tre..."
  // This is specifically for database entries where the summary was truncated before the closing bracket
  const truncatedPrefixPattern = /^\s*\[Context:[^\]]*$/i;
  if (truncatedPrefixPattern.test(cleaned)) {
    // If it's JUST a truncated context prefix and we have no other content, return default or null
    return returnDefaultOnEmpty ? 'New Session' : null;
  }

  if (truncatedAnalysisPreferencesPattern.test(cleaned)) {
    return returnDefaultOnEmpty ? 'New Session' : null;
  }

  if (truncatedMedHelpIdentityPattern.test(cleaned)) {
    return returnDefaultOnEmpty ? 'New Session' : null;
  }

  if (truncatedUserPreferencesPattern.test(cleaned)) {
    return returnDefaultOnEmpty ? 'New Session' : null;
  }

  if (truncatedExecutionMemoryPattern.test(cleaned)) {
    return returnDefaultOnEmpty ? 'New Session' : null;
  }

  if (truncatedResearchLessonsPattern.test(cleaned)) {
    return returnDefaultOnEmpty ? 'New Session' : null;
  }

  if (skillMarkdownPattern.test(cleaned)) {
    return returnDefaultOnEmpty ? 'New Session' : null;
  }

  let result = cleaned.trim();
  if (!result && hasMatch) {
    const embeddedUserRequestMatch = text.match(/User request:\s*([\s\S]*?)\s*$/i);
    if (embeddedUserRequestMatch?.[1]?.trim()) {
      result = stripInternalContextPrefix(embeddedUserRequestMatch[1].trim(), false) || '';
    }
  }
  
  // If we didn't find any context prefix and we have text, return it as is
  if (!hasMatch && result) {
    return result;
  }

  // If it's empty after cleaning, but we had a match (it was pure context)
  if (!result && hasMatch) {
    if (!returnDefaultOnEmpty) return null;
    
    // Fallback: If it's a new session and we ONLY have context, 
    // try to find some semantic info in the context itself or return a better default
    if (text.includes('session-mode=workspace_qa')) return 'Workspace Q&A';
    if (text.includes('session-mode=research')) return 'Research Session';
    
    return 'New Session';
  }
  
  return result || (returnDefaultOnEmpty ? 'New Session' : null);
}

/**
 * Derive a compact session title from the user's visible request text.
 * @param {string} text
 * @param {number} maxLength
 * @returns {string|null}
 */
export function buildSessionDisplayName(text, maxLength = 100) {
  const cleaned = stripInternalContextPrefix(text, false);
  if (!cleaned) {
    return null;
  }

  const firstVisibleLine = cleaned
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => line.trim())
    .find(Boolean);

  if (!firstVisibleLine) {
    return null;
  }

  if (/^\[Context:[^\]]*\]$/i.test(firstVisibleLine)) {
    return null;
  }

  let candidate = firstVisibleLine
    .replace(/^(?:[#>*-]+\s*)+/, '')
    .replace(/^\s*User request:\s*/i, '')
    .replace(/\s+/g, ' ')
    .trim();

  const helpMatch = candidate.match(/^Please help me with ["'](.+?)["']\.?$/i);
  if (helpMatch?.[1]?.trim()) {
    candidate = helpMatch[1].trim();
  }

  if (!candidate) {
    return null;
  }

  if (candidate.length <= maxLength) {
    return candidate;
  }

  if (maxLength <= 3) {
    return candidate.slice(0, maxLength);
  }

  return `${candidate.slice(0, maxLength - 3).trimEnd()}...`;
}
