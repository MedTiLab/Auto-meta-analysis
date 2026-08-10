export const buildImportedWorkspaceScanPrompt = (projectName?: string | null) => {
  const resolvedProjectName = projectName?.trim() || 'this workspace';

  return [
    `I just imported the workspace \"${resolvedProjectName}\".`,
    'Start by scanning the workspace and analyzing the project structure, stack, entry points, dependencies, and current implementation state.',
    'Then summarize what this project does, identify the main modules and important files, highlight any obvious risks or missing setup, and propose the most useful next steps.',
    'Do not wait for me to restate the project context before you begin.',
  ].join('\n\n');
};
