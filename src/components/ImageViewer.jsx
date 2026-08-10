import React, { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from './ui/button';
import { ChevronLeft, ChevronRight, X } from 'lucide-react';
import { authenticatedFetch } from '../utils/api';

const IMAGE_SWIPE_THRESHOLD = 48;

function ImageViewer({
  file,
  onClose,
  onPrevious,
  onNext,
  hasPrevious = false,
  hasNext = false,
  positionLabel = null,
}) {
  const { t } = useTranslation();
  const imagePath = `/api/projects/${file.projectName}/files/content?path=${encodeURIComponent(file.path)}`;
  const [imageUrl, setImageUrl] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);
  const touchStartXRef = useRef(null);

  useEffect(() => {
    let objectUrl;
    const controller = new AbortController();

    const loadImage = async () => {
      try {
        setLoading(true);
        setError(null);
        setImageUrl(null);

        const response = await authenticatedFetch(imagePath, {
          signal: controller.signal
        });

        if (!response.ok) {
          throw new Error(`Request failed with status ${response.status}`);
        }

        const blob = await response.blob();
        objectUrl = URL.createObjectURL(blob);
        setImageUrl(objectUrl);
      } catch (err) {
        if (err.name === 'AbortError') {
          return;
        }
        console.error('Error loading image:', err);
        setError('Unable to load image');
      } finally {
        setLoading(false);
      }
    };

    loadImage();

    return () => {
      controller.abort();
      if (objectUrl) {
        URL.revokeObjectURL(objectUrl);
      }
    };
  }, [imagePath]);

  useEffect(() => {
    const handleKeyDown = (event) => {
      if (event.key === 'Escape') {
        onClose?.();
        return;
      }

      if (event.key === 'ArrowLeft' && hasPrevious) {
        event.preventDefault();
        onPrevious?.();
      }

      if (event.key === 'ArrowRight' && hasNext) {
        event.preventDefault();
        onNext?.();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [hasNext, hasPrevious, onClose, onNext, onPrevious]);

  const handleTouchStart = (event) => {
    touchStartXRef.current = event.changedTouches?.[0]?.clientX ?? null;
  };

  const handleTouchEnd = (event) => {
    const startX = touchStartXRef.current;
    const endX = event.changedTouches?.[0]?.clientX ?? null;
    touchStartXRef.current = null;

    if (typeof startX !== 'number' || typeof endX !== 'number') {
      return;
    }

    const deltaX = endX - startX;
    if (deltaX >= IMAGE_SWIPE_THRESHOLD && hasPrevious) {
      onPrevious?.();
    } else if (deltaX <= -IMAGE_SWIPE_THRESHOLD && hasNext) {
      onNext?.();
    }
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl max-w-4xl max-h-[90vh] w-full mx-4 overflow-hidden">
        <div className="flex items-center justify-between p-4 border-b">
          <div className="min-w-0 flex-1">
            <h3 className="truncate text-lg font-semibold text-gray-900 dark:text-white">
              {file.name}
            </h3>
            {positionLabel ? (
              <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">{positionLabel}</p>
            ) : null}
          </div>
          <div className="ml-3 flex items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={onPrevious}
              disabled={!hasPrevious}
              className="h-8 w-8 p-0"
              title={t('fileTree.imageViewer.previous')}
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={onNext}
              disabled={!hasNext}
              className="h-8 w-8 p-0"
              title={t('fileTree.imageViewer.next')}
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={onClose}
              className="h-8 w-8 p-0"
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
        </div>

        <div
          className="relative flex min-h-[400px] items-center justify-center bg-gray-50 p-4 dark:bg-gray-900"
          onTouchStart={handleTouchStart}
          onTouchEnd={handleTouchEnd}
        >
          {hasPrevious ? (
            <Button
              variant="secondary"
              size="sm"
              onClick={onPrevious}
              className="absolute left-4 top-1/2 z-10 h-10 w-10 -translate-y-1/2 rounded-full border border-white/30 bg-black/65 p-0 text-white hover:bg-black/80"
              title={t('fileTree.imageViewer.previous')}
            >
              <ChevronLeft className="h-5 w-5" />
            </Button>
          ) : null}
          {loading && (
            <div className="text-center text-gray-500 dark:text-gray-400">
              <p>{t('fileTree.imageViewer.loading')}</p>
            </div>
          )}
          {!loading && imageUrl && (
            <img
              src={imageUrl}
              alt={file.name}
              className="max-w-full max-h-[70vh] object-contain rounded-lg shadow-md"
            />
          )}
          {!loading && !imageUrl && (
            <div className="text-center text-gray-500 dark:text-gray-400">
              <p>{error || t('fileTree.imageViewer.loadError')}</p>
              <p className="text-sm mt-2 break-all">{file.path}</p>
            </div>
          )}
          {hasNext ? (
            <Button
              variant="secondary"
              size="sm"
              onClick={onNext}
              className="absolute right-4 top-1/2 z-10 h-10 w-10 -translate-y-1/2 rounded-full border border-white/30 bg-black/65 p-0 text-white hover:bg-black/80"
              title={t('fileTree.imageViewer.next')}
            >
              <ChevronRight className="h-5 w-5" />
            </Button>
          ) : null}
        </div>

        <div className="p-4 border-t bg-gray-50 dark:bg-gray-800">
          <p className="text-sm text-gray-600 dark:text-gray-400">
            {file.path}
          </p>
        </div>
      </div>
    </div>
  );
}

export default ImageViewer;
