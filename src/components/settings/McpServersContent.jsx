import { Button } from '../ui/button';
import { Badge } from '../ui/badge';
import { Server, Plus, Edit3, Trash2, Terminal, Globe, Zap } from 'lucide-react';
import { useTranslation } from 'react-i18next';

const getTransportIcon = (type) => {
  switch (type) {
    case 'stdio': return <Terminal className="w-4 h-4" />;
    case 'sse': return <Zap className="w-4 h-4" />;
    case 'http': return <Globe className="w-4 h-4" />;
    default: return <Server className="w-4 h-4" />;
  }
};

// Claude MCP Servers
function ClaudeMcpServers({
  servers,
  onAdd,
  onEdit,
  onDelete,
  onTest,
  onDiscoverTools,
  testResults,
  serverTools,
  toolsLoading,
}) {
  const { t } = useTranslation('settings');
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <Server className="w-5 h-5 text-purple-500" />
        <h3 className="text-lg font-medium text-foreground">
          {t('mcpServers.title')}
        </h3>
      </div>
      <p className="text-sm text-muted-foreground">
        {t('mcpServers.description.claude')}
      </p>

      <div className="flex justify-between items-center">
        <Button
          onClick={onAdd}
          className="bg-purple-600 hover:bg-purple-700 text-white"
          size="sm"
        >
          <Plus className="w-4 h-4 mr-2" />
          {t('mcpServers.addButton')}
        </Button>
      </div>

      <div className="space-y-2">
        {servers.map(server => (
          <div key={server.id} className="bg-gray-50 dark:bg-gray-900/50 border border-gray-200 dark:border-gray-700 rounded-lg p-4">
            <div className="flex items-start justify-between">
              <div className="flex-1">
                <div className="flex items-center gap-2 mb-2">
                  {getTransportIcon(server.type)}
                  <span className="font-medium text-foreground">{server.name}</span>
                  <Badge variant="outline" className="text-xs">
                    {server.type}
                  </Badge>
                  <Badge variant="outline" className="text-xs">
                    {server.scope === 'local' ? t('mcpServers.scope.local') : server.scope === 'user' ? t('mcpServers.scope.user') : server.scope}
                  </Badge>
                </div>

                <div className="text-sm text-muted-foreground space-y-1">
                  {server.type === 'stdio' && server.config?.command && (
                    <div>{t('mcpServers.config.command')}: <code className="bg-gray-100 dark:bg-gray-800 px-1 rounded text-xs">{server.config.command}</code></div>
                  )}
                  {(server.type === 'sse' || server.type === 'http') && server.config?.url && (
                    <div>{t('mcpServers.config.url')}: <code className="bg-gray-100 dark:bg-gray-800 px-1 rounded text-xs">{server.config.url}</code></div>
                  )}
                  {server.config?.args && server.config.args.length > 0 && (
                    <div>{t('mcpServers.config.args')}: <code className="bg-gray-100 dark:bg-gray-800 px-1 rounded text-xs">{server.config.args.join(' ')}</code></div>
                  )}
                </div>

                {/* Test Results */}
                {testResults?.[server.id] && (
                  <div className={`mt-2 p-2 rounded text-xs ${
                    testResults[server.id].success
                      ? 'bg-green-50 dark:bg-green-900/20 text-green-800 dark:text-green-200'
                      : 'bg-red-50 dark:bg-red-900/20 text-red-800 dark:text-red-200'
                  }`}>
                    <div className="font-medium">{testResults[server.id].message}</div>
                  </div>
                )}

                {/* Tools Discovery Results */}
                {serverTools?.[server.id] && serverTools[server.id].tools?.length > 0 && (
                  <div className="mt-2 p-2 rounded text-xs bg-blue-50 dark:bg-blue-900/20 text-blue-800 dark:text-blue-200">
                    <div className="font-medium">{t('mcpServers.tools.title')} {t('mcpServers.tools.count', { count: serverTools[server.id].tools.length })}</div>
                    <div className="flex flex-wrap gap-1 mt-1">
                      {serverTools[server.id].tools.slice(0, 5).map((tool, i) => (
                        <code key={i} className="bg-blue-100 dark:bg-blue-800 px-1 rounded">{tool.name}</code>
                      ))}
                      {serverTools[server.id].tools.length > 5 && (
                        <span className="text-xs opacity-75">{t('mcpServers.tools.more', { count: serverTools[server.id].tools.length - 5 })}</span>
                      )}
                    </div>
                  </div>
                )}
              </div>

              <div className="flex items-center gap-2 ml-4">
                <Button
                  onClick={() => onEdit(server)}
                  variant="ghost"
                  size="sm"
                  className="text-gray-600 hover:text-gray-700"
                  title={t('mcpServers.actions.edit')}
                >
                  <Edit3 className="w-4 h-4" />
                </Button>
                <Button
                  onClick={() => onDelete(server.id, server.scope)}
                  variant="ghost"
                  size="sm"
                  className="text-red-600 hover:text-red-700"
                  title={t('mcpServers.actions.delete')}
                >
                  <Trash2 className="w-4 h-4" />
                </Button>
              </div>
            </div>
          </div>
        ))}
        {servers.length === 0 && (
          <div className="text-center py-8 text-gray-500 dark:text-gray-400">
            {t('mcpServers.empty')}
          </div>
        )}
      </div>
    </div>
  );
}

// Main component
export default function McpServersContent(props) {
  return <ClaudeMcpServers {...props} />;
}
