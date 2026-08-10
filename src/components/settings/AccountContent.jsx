import { Button } from '../ui/button';
import { Badge } from '../ui/badge';
import { LogIn } from 'lucide-react';
import { useTranslation } from 'react-i18next';

const agentConfig = {
  claude: {
    name: 'MedHelp',
    cliCommand: 'claude',
    bgClass: 'bg-teal-50 dark:bg-teal-950/30',
    borderClass: 'border-teal-200 dark:border-teal-900/50',
    textClass: 'text-teal-950 dark:text-teal-100',
    subtextClass: 'text-teal-700 dark:text-teal-300',
    buttonClass: 'bg-teal-600 hover:bg-teal-700',
  },
};

function MedHelpAgentLogo({ className = 'w-6 h-6' }) {
  return (
    <img
      src="/icons/meta-m.svg"
      alt="Meta"
      className={`${className} rounded-sm object-contain`}
      loading="eager"
      decoding="sync"
      fetchpriority="high"
    />
  );
}

export default function AccountContent({ agent = 'claude', authStatus, onLogin }) {
  const { t } = useTranslation('settings');
  const config = agentConfig[agent] || agentConfig.claude;
  const cliMissing = authStatus?.cliAvailable === false;
  const installHint = authStatus?.installHint;

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3 mb-4">
        <MedHelpAgentLogo className="w-6 h-6" />
        <div>
          <h3 className="text-lg font-medium text-foreground">{config.name}</h3>
          <p className="text-sm text-muted-foreground">{t('agents.account.claude.description')}</p>
        </div>
      </div>

      <div className={`${config.bgClass} border ${config.borderClass} rounded-lg p-4`}>
        <div className="space-y-4">
          <div className="flex items-center gap-3">
            <div className="flex-1">
              <div className={`font-medium ${config.textClass}`}>
                {t('agents.connectionStatus')}
              </div>
              <div className={`text-sm ${config.subtextClass}`}>
                {authStatus?.loading ? (
                  t('agents.authStatus.checkingAuth')
                ) : cliMissing ? (
                  t('agents.authStatus.cliMissing', { command: authStatus?.cliCommand || config.cliCommand })
                ) : authStatus?.authenticated ? (
                  t('agents.authStatus.loggedInAs', { email: authStatus.email || t('agents.authStatus.authenticatedUser') })
                ) : (
                  t('agents.authStatus.notConnected')
                )}
              </div>
            </div>
            <div>
              {authStatus?.loading ? (
                <Badge variant="secondary" className="bg-gray-100 dark:bg-gray-800">
                  {t('agents.authStatus.checking')}
                </Badge>
              ) : cliMissing ? (
                <Badge variant="secondary" className="bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300">
                  {t('agents.authStatus.installRequired')}
                </Badge>
              ) : authStatus?.authenticated ? (
                <Badge variant="success" className="bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300">
                  {t('agents.authStatus.connected')}
                </Badge>
              ) : (
                <Badge variant="secondary" className="bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-300">
                  {t('agents.authStatus.disconnected')}
                </Badge>
              )}
            </div>
          </div>

          <div className="border-t border-gray-200 dark:border-gray-700 pt-4">
            <div className="flex items-center justify-between">
              <div>
                <div className={`font-medium ${config.textClass}`}>
                  {authStatus?.authenticated ? t('agents.login.reAuthenticate') : t('agents.login.title')}
                </div>
                <div className={`text-sm ${config.subtextClass}`}>
                  {authStatus?.authenticated
                    ? t('agents.login.reAuthDescription')
                    : cliMissing
                      ? t('agents.login.installDescription', { command: authStatus?.cliCommand || config.cliCommand })
                      : t('agents.login.description', { agent: config.name })}
                </div>
              </div>
              <Button
                onClick={onLogin}
                className={`${config.buttonClass} text-white`}
                size="sm"
                disabled={authStatus?.loading || cliMissing}
              >
                <LogIn className="w-4 h-4 mr-2" />
                {authStatus?.authenticated ? t('agents.login.reLoginButton') : t('agents.login.button')}
              </Button>
            </div>
          </div>

          {cliMissing && installHint && (
            <div className="border-t border-gray-200 dark:border-gray-700 pt-4">
              <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:border-amber-900/40 dark:bg-amber-950/30 dark:text-amber-200">
                <div className="font-medium">{t('agents.install.title')}</div>
                <div className="mt-1">{installHint}</div>
                <div className="mt-2 font-mono text-xs">{authStatus?.cliCommand || config.cliCommand}</div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
