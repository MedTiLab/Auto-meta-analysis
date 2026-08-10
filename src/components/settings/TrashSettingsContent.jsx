import React, { useCallback, useEffect, useState } from 'react';
import { RefreshCcw, Trash2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { api } from '../../utils/api';
import { Button } from '../ui/button';

const TrashDashboard = React.lazy(() => import('../project-dashboard/view/TrashDashboard'));

function TrashDashboardFallback() {
  return (
    <div className="flex h-full w-full items-center justify-center text-muted-foreground">
      <div className="h-8 w-8 rounded-full border-2 border-muted border-t-primary animate-spin" />
    </div>
  );
}

export default function TrashSettingsContent() {
  const { t } = useTranslation(['settings', 'common']);
  const [trashProjects, setTrashProjects] = useState([]);
  const [trashSessions, setTrashSessions] = useState([]);
  const [isLoading, setIsLoading] = useState(true);

  const loadTrash = useCallback(async () => {
    setIsLoading(true);
    try {
      const [projectsResponse, sessionsResponse] = await Promise.all([
        api.trashedProjects(),
        api.trashedSessions(),
      ]);

      const [projectsData, sessionsData] = await Promise.all([
        projectsResponse.ok ? projectsResponse.json() : Promise.resolve([]),
        sessionsResponse.ok ? sessionsResponse.json() : Promise.resolve([]),
      ]);

      setTrashProjects(Array.isArray(projectsData) ? projectsData : []);
      setTrashSessions(Array.isArray(sessionsData) ? sessionsData : []);
    } catch (error) {
      console.error('Failed to load trash content for settings:', error);
      setTrashProjects([]);
      setTrashSessions([]);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadTrash();
  }, [loadTrash]);

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex items-start gap-3">
          <div className="rounded-lg border border-amber-200 bg-amber-50 p-2 text-amber-700 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-300">
            <Trash2 className="w-4 h-4" />
          </div>
          <div>
            <h3 className="text-lg font-semibold text-foreground">{t('trash.title')}</h3>
            <p className="text-sm text-muted-foreground">{t('trash.description')}</p>
          </div>
        </div>

        <Button
          type="button"
          variant="outline"
          onClick={() => {
            void loadTrash();
          }}
          disabled={isLoading}
        >
          <RefreshCcw className={`mr-2 h-4 w-4 ${isLoading ? 'animate-spin' : ''}`} />
          {t('trash.refresh')}
        </Button>
      </div>

      <div className="h-[min(68vh,720px)] min-h-[420px] overflow-hidden rounded-2xl border border-border bg-card">
        <React.Suspense fallback={<TrashDashboardFallback />}>
          <TrashDashboard
            projects={trashProjects}
            sessions={trashSessions}
            isLoading={isLoading}
            onRefresh={loadTrash}
          />
        </React.Suspense>
      </div>
    </div>
  );
}
