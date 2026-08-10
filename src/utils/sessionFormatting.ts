/**
 * Utility functions for formatting and cleaning session content on the frontend.
 */

/**
 * Strips internal [Context: ...] prefixes from message text.
 * Handles full prefixes [Context: ...] and common truncated ones like [Context: Tre...
 * @param value - The message text
 * @param returnDefaultOnEmpty - Whether to return 'New Session' if result is empty
 * @returns - Cleaned text or null/default if empty
 */
export const stripInternalContextPrefix = (value: string, returnDefaultOnEmpty = true): string | null => {
  if (typeof value !== 'string') return returnDefaultOnEmpty ? '' : null;
  let cleaned = value;
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
  const truncatedPrefixPattern = /^\s*\[Context:[^\]]*$/i;
  if (truncatedPrefixPattern.test(cleaned)) {
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
    const embeddedUserRequestMatch = value.match(/User request:\s*([\s\S]*?)\s*$/i);
    if (embeddedUserRequestMatch?.[1]?.trim()) {
      result = stripInternalContextPrefix(embeddedUserRequestMatch[1].trim(), false) || '';
    }
  }

  if (!hasMatch && result) {
    return result;
  }

  if (!result && hasMatch) {
    if (!returnDefaultOnEmpty) return null;
    
    // Semantic fallbacks
    if (value.includes('session-mode=workspace_qa')) return 'Workspace Q&A';
    if (value.includes('session-mode=research')) return 'Research Session';
    
    return 'New Session';
  }

  return result || (returnDefaultOnEmpty ? 'New Session' : null);
};
