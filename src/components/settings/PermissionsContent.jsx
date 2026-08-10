import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Shield, AlertTriangle, Plus, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';

// Common tool patterns for Claude
const commonClaudeTools = [
  'Write',
  'Read',
  'Edit',
  'Glob',
  'Grep',
  'MultiEdit',
  'Task',
  'TodoWrite',
  'TodoRead',
  'WebFetch',
  'WebSearch'
];

// Claude Permissions
function ClaudePermissions({
  allowedTools,
  setAllowedTools,
  disallowedTools,
  setDisallowedTools,
  newAllowedTool,
  setNewAllowedTool,
  newDisallowedTool,
  setNewDisallowedTool,
}) {
  const { t } = useTranslation('settings');
  const addAllowedTool = (tool) => {
    if (tool && !allowedTools.includes(tool)) {
      setAllowedTools([...allowedTools, tool]);
      setNewAllowedTool('');
    }
  };

  const removeAllowedTool = (tool) => {
    setAllowedTools(allowedTools.filter(t => t !== tool));
  };

  const addDisallowedTool = (tool) => {
    if (tool && !disallowedTools.includes(tool)) {
      setDisallowedTools([...disallowedTools, tool]);
      setNewDisallowedTool('');
    }
  };

  const removeDisallowedTool = (tool) => {
    setDisallowedTools(disallowedTools.filter(t => t !== tool));
  };

  return (
    <div className="space-y-6">
      {/* Allowed Tools */}
      <div className="space-y-4">
        <div className="flex items-center gap-3">
          <Shield className="w-5 h-5 text-green-500" />
          <h3 className="text-lg font-medium text-foreground">
            {t('permissions.allowedTools.title')}
          </h3>
        </div>
        <p className="text-sm text-muted-foreground">
          {t('permissions.allowedTools.description')}
        </p>

        <div className="flex flex-col sm:flex-row gap-2">
          <Input
            value={newAllowedTool}
            onChange={(e) => setNewAllowedTool(e.target.value)}
            placeholder={t('permissions.allowedTools.placeholder')}
            onKeyPress={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                addAllowedTool(newAllowedTool);
              }
            }}
            className="flex-1 h-10"
          />
          <Button
            onClick={() => addAllowedTool(newAllowedTool)}
            disabled={!newAllowedTool}
            size="sm"
            className="h-10 px-4"
          >
            <Plus className="w-4 h-4 mr-2 sm:mr-0" />
            <span className="sm:hidden">{t('permissions.actions.add')}</span>
          </Button>
        </div>

        {/* Quick add buttons */}
        <div className="space-y-2">
          <p className="text-sm font-medium text-gray-700 dark:text-gray-300">
            {t('permissions.allowedTools.quickAdd')}
          </p>
          <div className="flex flex-wrap gap-2">
            {commonClaudeTools.map(tool => (
              <Button
                key={tool}
                variant="outline"
                size="sm"
                onClick={() => addAllowedTool(tool)}
                disabled={allowedTools.includes(tool)}
                className="text-xs h-8"
              >
                {tool}
              </Button>
            ))}
          </div>
        </div>

        <div className="space-y-2">
          {allowedTools.map(tool => (
            <div key={tool} className="flex items-center justify-between bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg p-3">
              <span className="font-mono text-sm text-green-800 dark:text-green-200">
                {tool}
              </span>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => removeAllowedTool(tool)}
                className="text-green-600 hover:text-green-700"
              >
                <X className="w-4 h-4" />
              </Button>
            </div>
          ))}
          {allowedTools.length === 0 && (
            <div className="text-center py-6 text-gray-500 dark:text-gray-400">
              {t('permissions.allowedTools.empty')}
            </div>
          )}
        </div>
      </div>

      {/* Disallowed Tools */}
      <div className="space-y-4">
        <div className="flex items-center gap-3">
          <AlertTriangle className="w-5 h-5 text-red-500" />
          <h3 className="text-lg font-medium text-foreground">
            {t('permissions.blockedTools.title')}
          </h3>
        </div>
        <p className="text-sm text-muted-foreground">
          {t('permissions.blockedTools.description')}
        </p>

        <div className="flex flex-col sm:flex-row gap-2">
          <Input
            value={newDisallowedTool}
            onChange={(e) => setNewDisallowedTool(e.target.value)}
            placeholder={t('permissions.blockedTools.placeholder')}
            onKeyPress={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                addDisallowedTool(newDisallowedTool);
              }
            }}
            className="flex-1 h-10"
          />
          <Button
            onClick={() => addDisallowedTool(newDisallowedTool)}
            disabled={!newDisallowedTool}
            size="sm"
            className="h-10 px-4"
          >
            <Plus className="w-4 h-4 mr-2 sm:mr-0" />
            <span className="sm:hidden">{t('permissions.actions.add')}</span>
          </Button>
        </div>

        <div className="space-y-2">
          {disallowedTools.map(tool => (
            <div key={tool} className="flex items-center justify-between bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-3">
              <span className="font-mono text-sm text-red-800 dark:text-red-200">
                {tool}
              </span>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => removeDisallowedTool(tool)}
                className="text-red-600 hover:text-red-700"
              >
                <X className="w-4 h-4" />
              </Button>
            </div>
          ))}
          {disallowedTools.length === 0 && (
            <div className="text-center py-6 text-gray-500 dark:text-gray-400">
              {t('permissions.blockedTools.empty')}
            </div>
          )}
        </div>
      </div>

      {/* Help Section */}
      <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg p-4">
        <h4 className="font-medium text-blue-900 dark:text-blue-100 mb-2">
          {t('permissions.toolExamples.title')}
        </h4>
        <ul className="text-sm text-blue-800 dark:text-blue-200 space-y-1">
          <li><code className="bg-blue-100 dark:bg-blue-800 px-1 rounded">"Bash(git log:*)"</code> {t('permissions.toolExamples.bashGitLog')}</li>
          <li><code className="bg-blue-100 dark:bg-blue-800 px-1 rounded">"Bash(git diff:*)"</code> {t('permissions.toolExamples.bashGitDiff')}</li>
          <li><code className="bg-blue-100 dark:bg-blue-800 px-1 rounded">"Write"</code> {t('permissions.toolExamples.write')}</li>
          <li><code className="bg-blue-100 dark:bg-blue-800 px-1 rounded">"Bash(rm:*)"</code> {t('permissions.toolExamples.bashRm')}</li>
        </ul>
      </div>
    </div>
  );
}

// Main component
export default function PermissionsContent(props) {
  return <ClaudePermissions {...props} />;
}
