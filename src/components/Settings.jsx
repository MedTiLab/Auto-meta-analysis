import { useEffect, useState } from 'react';
import { Brain, Check, Cpu, FolderOpen, Monitor, Plug, Shield, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useTheme } from '../contexts/ThemeContext';
import { api } from '../utils/api';
import PermissionsContent from './settings/PermissionsContent';
import MemorySettingsContent from './settings/MemorySettingsContent';
import MinerUSettingsContent from './settings/MinerUSettingsContent';
import ProjectLocationContent from './settings/ProjectLocationContent';
import LlmProvidersContent from './settings/LlmProvidersContent';
import LanguageSelector from './LanguageSelector';

const EMPTY_SETTINGS = {
  allowedTools: [],
  disallowedTools: [],
  projectSortOrder: 'date',
};

export default function Settings({ isOpen, onClose, projects, initialTab = 'projects' }) {
  const { t } = useTranslation('settings');
  const { isDarkMode, toggleDarkMode } = useTheme();
  const [activeTab, setActiveTab] = useState('projects');
  const [allowedTools, setAllowedTools] = useState([]);
  const [disallowedTools, setDisallowedTools] = useState([]);
  const [newAllowedTool, setNewAllowedTool] = useState('');
  const [newDisallowedTool, setNewDisallowedTool] = useState('');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    const supportedTabs = new Set(['projects', 'providers', 'permissions', 'memory', 'integrations', 'appearance']);
    setActiveTab(supportedTabs.has(initialTab) ? initialTab : 'projects');
    const load = async () => {
      try {
        const response = await api.settings.agentPermissions('claude');
        const payload = await response.json().catch(() => ({}));
        const settings = response.ok ? payload.settings || EMPTY_SETTINGS : EMPTY_SETTINGS;
        setAllowedTools(Array.isArray(settings.allowedTools) ? settings.allowedTools : []);
        setDisallowedTools(Array.isArray(settings.disallowedTools) ? settings.disallowedTools : []);
      } catch {
        setAllowedTools([]);
        setDisallowedTools([]);
      }
    };
    void load();
  }, [initialTab, isOpen]);

  if (!isOpen) return null;

  const save = async () => {
    setSaving(true);
    setSaved(false);
    try {
      const response = await api.settings.updateAgentPermissions('claude', {
        allowedTools,
        disallowedTools,
        skipPermissions: false,
        projectSortOrder: 'date',
      });
      if (!response.ok) throw new Error('Failed to save permissions');
      setSaved(true);
      window.setTimeout(() => setSaved(false), 1600);
    } finally {
      setSaving(false);
    }
  };

  const tabs = [
    { id: 'projects', label: t('tabs.projects'), icon: FolderOpen },
    { id: 'providers', label: t('tabs.llmProviders'), icon: Cpu },
    { id: 'permissions', label: t('tabs.permissions'), icon: Shield },
    { id: 'memory', label: t('tabs.memory'), icon: Brain },
    { id: 'integrations', label: t('tabs.integrations'), icon: Plug },
    { id: 'appearance', label: t('mainTabs.appearance'), icon: Monitor },
  ];

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-background/90 p-0 backdrop-blur-sm md:p-6">
      <div className="flex h-full w-full max-w-6xl flex-col border-border bg-background md:h-[86vh] md:border">
        <header className="flex h-14 flex-shrink-0 items-center justify-between border-b border-border px-5">
          <h2 className="text-sm font-semibold tracking-wide text-foreground">{t('title')}</h2>
          <button type="button" onClick={onClose} className="grid h-8 w-8 place-items-center text-muted-foreground hover:text-foreground">
            <X className="h-4 w-4" />
          </button>
        </header>

        <div className="flex min-h-0 flex-1 flex-col md:flex-row">
          <nav className="flex flex-shrink-0 gap-1 overflow-x-auto border-b border-border p-2 md:w-44 md:flex-col md:overflow-visible md:border-b-0 md:border-r">
            {tabs.map((tab) => {
              const Icon = tab.icon;
              const active = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setActiveTab(tab.id)}
                  className={`flex h-9 min-w-max flex-none items-center gap-2 px-3 text-xs font-medium ${active ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:bg-primary/5 hover:text-foreground'}`}
                >
                  <Icon className="h-4 w-4" />
                  {tab.label}
                </button>
              );
            })}
          </nav>

          <main className="min-h-0 flex-1 overflow-y-auto p-5 md:p-7">
            {activeTab === 'projects' ? (
              <ProjectLocationContent />
            ) : activeTab === 'providers' ? (
              <LlmProvidersContent />
            ) : activeTab === 'permissions' ? (
              <PermissionsContent
                agent="claude"
                skipPermissions={false}
                setSkipPermissions={() => undefined}
                allowedTools={allowedTools}
                setAllowedTools={setAllowedTools}
                disallowedTools={disallowedTools}
                setDisallowedTools={setDisallowedTools}
                newAllowedTool={newAllowedTool}
                setNewAllowedTool={setNewAllowedTool}
                newDisallowedTool={newDisallowedTool}
                setNewDisallowedTool={setNewDisallowedTool}
              />
            ) : activeTab === 'memory' ? (
              <MemorySettingsContent projects={projects || []} />
            ) : activeTab === 'integrations' ? (
              <MinerUSettingsContent />
            ) : (
              <div className="space-y-8">
                <div>
                  <h3 className="text-lg font-medium text-foreground">{t('mainTabs.appearance')}</h3>
                  <p className="mt-1 text-sm text-muted-foreground">Black, white, and the minimum settings needed for a local workspace.</p>
                </div>
                <div className="flex items-center justify-between border-b border-border pb-5">
                  <div>
                    <p className="text-sm font-medium text-foreground">{t('appearanceSettings.darkMode.label')}</p>
                    <p className="mt-1 text-xs text-muted-foreground">{t('appearanceSettings.darkMode.description')}</p>
                  </div>
                  <button
                    type="button"
                    onClick={toggleDarkMode}
                    className={`h-8 min-w-20 px-3 text-xs font-medium ${isDarkMode ? 'bg-foreground text-background' : 'border border-border text-foreground'}`}
                  >
                    {isDarkMode ? 'Dark' : 'Light'}
                  </button>
                </div>
                <LanguageSelector />
              </div>
            )}
          </main>
        </div>

        <footer className="flex h-14 flex-shrink-0 items-center justify-between border-t border-border px-5">
          <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
            {saved && <><Check className="h-3.5 w-3.5" /> {t('saveStatus.success')}</>}
          </span>
          <div className="flex items-center gap-2">
            <button type="button" onClick={onClose} className="h-9 px-4 text-xs text-muted-foreground hover:text-foreground">
              {t('footerActions.cancel')}
            </button>
            {activeTab === 'permissions' && (
              <button
                type="button"
                onClick={() => void save()}
                disabled={saving}
                className="h-9 bg-primary/90 px-4 text-xs font-medium text-primary-foreground hover:bg-primary disabled:opacity-40"
              >
                {saving ? t('saveStatus.saving') : t('footerActions.save')}
              </button>
            )}
          </div>
        </footer>
      </div>
    </div>
  );
}
