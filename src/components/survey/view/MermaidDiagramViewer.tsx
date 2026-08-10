import { useEffect, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Badge } from '../../ui/badge';
import { Button } from '../../ui/button';
import { Move, Scan, ZoomIn, ZoomOut, ExternalLink } from 'lucide-react';

type MermaidDiagramViewerProps = {
  svg: string;
  onOpenInWindow?: () => void;
  fullWindow?: boolean;
};

export default function MermaidDiagramViewer({
  svg,
  onOpenInWindow,
  fullWindow = false,
}: MermaidDiagramViewerProps) {
  const { t } = useTranslation('common');
  const containerRef = useRef<HTMLDivElement | null>(null);
  const dragStateRef = useRef({ dragging: false, x: 0, y: 0, left: 0, top: 0 });
  const [zoom, setZoom] = useState(fullWindow ? 1.8 : 1.4);

  useEffect(() => {
    setZoom(fullWindow ? 1.8 : 1.4);
  }, [fullWindow, svg]);

  const handleZoomIn = () => setZoom((current) => Math.min(current + 0.2, 4));
  const handleZoomOut = () => setZoom((current) => Math.max(current - 0.2, 0.4));
  const handleReset = () => setZoom(fullWindow ? 1.8 : 1.4);
  const handleFit = () => setZoom(1);

  const handleMouseDown = (event: ReactMouseEvent<HTMLDivElement>) => {
    const container = containerRef.current;
    if (!container) {
      return;
    }

    dragStateRef.current = {
      dragging: true,
      x: event.clientX,
      y: event.clientY,
      left: container.scrollLeft,
      top: container.scrollTop,
    };
  };

  const handleMouseMove = (event: ReactMouseEvent<HTMLDivElement>) => {
    const container = containerRef.current;
    const dragState = dragStateRef.current;
    if (!container || !dragState.dragging) {
      return;
    }

    container.scrollLeft = dragState.left - (event.clientX - dragState.x);
    container.scrollTop = dragState.top - (event.clientY - dragState.y);
  };

  const stopDragging = () => {
    dragStateRef.current.dragging = false;
  };

  return (
    <div className="rounded-lg border border-border/60 bg-background/80">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border/50 px-3 py-2">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Move className="h-3.5 w-3.5" />
          <span>{t('surveyPage.preview.dragHint')}</span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="outline">{Math.round(zoom * 100)}%</Badge>
          <Button type="button" size="sm" variant="outline" onClick={handleZoomOut}>
            <ZoomOut className="h-4 w-4" />
            {t('surveyPage.preview.zoomOut')}
          </Button>
          <Button type="button" size="sm" variant="outline" onClick={handleZoomIn}>
            <ZoomIn className="h-4 w-4" />
            {t('surveyPage.preview.zoomIn')}
          </Button>
          <Button type="button" size="sm" variant="outline" onClick={handleFit}>
            <Scan className="h-4 w-4" />
            {t('surveyPage.preview.fit')}
          </Button>
          <Button type="button" size="sm" variant="outline" onClick={handleReset}>
            {t('surveyPage.preview.resetZoom')}
          </Button>
          {onOpenInWindow ? (
            <Button type="button" size="sm" variant="outline" onClick={onOpenInWindow}>
              <ExternalLink className="h-4 w-4" />
              {t('surveyPage.preview.openInWindow')}
            </Button>
          ) : null}
        </div>
      </div>

      <div
        ref={containerRef}
        className={`${fullWindow ? 'h-[calc(100vh-80px)]' : 'h-[72vh]'} overflow-auto cursor-grab active:cursor-grabbing bg-[radial-gradient(circle_at_top,_rgba(148,163,184,0.18),_transparent_50%)]`}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={stopDragging}
        onMouseLeave={stopDragging}
      >
        <div className="min-h-full min-w-full p-6">
          <div
            className="origin-top-left rounded-lg bg-white p-4 shadow-sm [&_svg]:block [&_svg]:h-auto [&_svg]:max-w-none [&_svg]:min-w-full"
            style={{ width: `${Math.max(zoom * 100, 100)}%` }}
            dangerouslySetInnerHTML={{ __html: svg }}
          />
        </div>
      </div>
    </div>
  );
}
