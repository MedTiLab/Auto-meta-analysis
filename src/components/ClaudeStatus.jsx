import React, { useState, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { cn } from '../lib/utils';
import { resolveChatStatusText, shouldAppendStatusEllipsis } from './chat/utils/statusText';

function ClaudeStatus({ status, onAbort, isLoading, provider = 'claude' }) {
  const { t } = useTranslation('chat');
  const [elapsedTime, setElapsedTime] = useState(0);
  const [animationPhase, setAnimationPhase] = useState(0);
  const startTimeRef = useRef(null);

  // Update elapsed time every second
  useEffect(() => {
    if (!isLoading) {
      setElapsedTime(0);
      startTimeRef.current = null;
      return;
    }

    // Capture the start time from the status prop. 
    // We do NOT fallback to Date.now() here because if we are refreshing,
    // we want to wait for the real time from the backend (via check-session-status or deltas).
    // For brand new requests, useChatComposerState provides it immediately.
    if (typeof status?.startTime === 'number') {
      startTimeRef.current = status.startTime;
    }
    
    if (!startTimeRef.current) {
      setElapsedTime(0);
      return;
    }
    
    const startTime = startTimeRef.current;
    
    // Sync initial state
    setElapsedTime(Math.max(0, Math.floor((Date.now() - startTime) / 1000)));

    const timer = setInterval(() => {
      setElapsedTime(Math.max(0, Math.floor((Date.now() - startTime) / 1000)));
    }, 1000);

    return () => clearInterval(timer);
  }, [isLoading, status?.startTime]);

  // Animate the status indicator
  useEffect(() => {
    if (!isLoading) return;

    const timer = setInterval(() => {
      setAnimationPhase(prev => (prev + 1) % 4);
    }, 500);

    return () => clearInterval(timer);
  }, [isLoading]);

  // Don't show if loading is false
  // Note: showThinking only controls the reasoning accordion in messages, not this processing indicator
  if (!isLoading) return null;
  
  // Clever action words that cycle
  const actionWords = ['Thinking', 'Processing', 'Analyzing', 'Working', 'Computing', 'Reasoning'];
  const actionIndex = Math.floor(elapsedTime / 3) % actionWords.length;
  
  // Parse status data
  const statusText = resolveChatStatusText(status?.text || actionWords[actionIndex], t, 'status.processing');
  const statusSuffix = shouldAppendStatusEllipsis(statusText) ? '...' : '';
  const canInterrupt = status?.can_interrupt !== false;
  
  // Animation characters
  const spinners = ['✻', '✹', '✸', '✶'];
  const currentSpinner = spinners[animationPhase];
  
  const tokens = status?.tokens || 0;

  return (
    <div className="inline-flex items-center gap-2 bg-gray-800 dark:bg-gray-900 text-white rounded-lg px-3 py-1.5 border border-gray-700 dark:border-gray-800 shadow-sm animate-in fade-in duration-200">
      <span className={cn(
        "text-base text-blue-500 transition-transform duration-500 flex-shrink-0",
        animationPhase % 2 === 0 ? "scale-110" : "scale-100"
      )}>
        {currentSpinner}
      </span>
      <span className="font-medium text-sm truncate max-w-[100px] sm:max-w-none">{statusText}{statusSuffix}</span>
      {startTimeRef.current !== null && (
        <span className="text-gray-400 text-sm flex-shrink-0">({elapsedTime}s)</span>
      )}
      {tokens > 0 && (
        <>
          <span className="text-gray-500">·</span>
          <span className="text-gray-300 text-sm flex-shrink-0">⚒ {tokens.toLocaleString()}</span>
        </>
      )}
      {canInterrupt && onAbort && (
        <button
          onClick={onAbort}
          className="ml-1 text-xs bg-blue-600 hover:bg-blue-700 active:bg-blue-800 text-white px-2 py-1 rounded-md transition-colors flex items-center gap-1 flex-shrink-0 font-medium"
        >
          <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
          Stop
        </button>
      )}
    </div>
  );
}

export default ClaudeStatus;
