import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { AlertCircle, Loader2 } from 'lucide-react';
import MermaidDiagramViewer from './MermaidDiagramViewer';
import { loadSurveyDiagramSource } from '../utils/diagramWindow';

export default function SurveyDiagramWindow() {
  const { t } = useTranslation('common');
  const [searchParams] = useSearchParams();
  const [loading, setLoading] = useState(true);
  const [svg, setSvg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      const diagramId = searchParams.get('diagramId');
      if (!diagramId) {
        setError('missing-diagram');
        setLoading(false);
        return;
      }

      const source = loadSurveyDiagramSource(diagramId);
      if (!source) {
        setError('missing-source');
        setLoading(false);
        return;
      }

      try {
        const mermaid = (await import('mermaid')).default;
        mermaid.initialize({
          startOnLoad: false,
          securityLevel: 'loose',
          theme: document.documentElement.classList.contains('dark') ? 'dark' : 'default',
        });

        const renderId = `survey-window-mermaid-${Date.now().toString(36)}`;
        const { svg: renderedSvg } = await mermaid.render(renderId, source);
        if (!cancelled) {
          setSvg(renderedSvg);
          setLoading(false);
        }
      } catch (renderError) {
        console.error('Failed to render survey diagram window:', renderError);
        if (!cancelled) {
          setError('render-failed');
          setLoading(false);
        }
      }
    };

    void load();

    return () => {
      cancelled = true;
    };
  }, [searchParams]);

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background text-sm text-muted-foreground">
        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
        {t('surveyPage.preview.loading')}
      </div>
    );
  }

  if (error || !svg) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background px-6 text-center text-sm text-destructive">
        <AlertCircle className="mr-2 h-4 w-4" />
        {t('surveyPage.preview.windowLoadFailed')}
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background p-4">
      <MermaidDiagramViewer svg={svg} fullWindow />
    </div>
  );
}
