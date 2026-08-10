import React, { useState, useEffect, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { Mic, MicOff } from 'lucide-react';

const SpeechRecognition = typeof window !== 'undefined'
  ? (window.SpeechRecognition || window.webkitSpeechRecognition)
  : null;

export function MicButton({ onTranscript, className = '' }) {
  const [state, setState] = useState('idle'); // idle | recording
  const [error, setError] = useState(null);
  const recognitionRef = useRef(null);
  const lastTapRef = useRef(0);
  const committedIndexRef = useRef(0); // index of next result to commit
  const buttonRef = useRef(null);
  const [tooltipPos, setTooltipPos] = useState(null);

  const isSupported = !!SpeechRecognition;

  const stopRecording = useCallback(() => {
    if (recognitionRef.current) {
      recognitionRef.current.stop();
      recognitionRef.current = null;
    }
    setState('idle');
  }, []);

  const startRecording = useCallback(() => {
    setError(null);
    committedIndexRef.current = 0;

    const recognition = new SpeechRecognition();
    recognition.lang = navigator.language?.startsWith('zh') ? 'zh-CN' : 'en-US';
    recognition.continuous = true;
    recognition.interimResults = true;

    recognition.onresult = (event) => {
      // Collect only NEW final results (index >= committedIndex)
      let newFinal = '';

      for (let i = committedIndexRef.current; i < event.results.length; i++) {
        const result = event.results[i];
        if (result.isFinal) {
          newFinal += result[0].transcript;
          committedIndexRef.current = i + 1;
        }
      }

      // Only call onTranscript with genuinely new finalized text
      if (newFinal && onTranscript) {
        onTranscript(newFinal);
      }
    };

    recognition.onerror = (event) => {
      console.error('Speech recognition error:', event.error);
      const err = event.error;
      if (err === 'not-allowed') {
        setError('Microphone access denied. Please allow microphone permissions.');
      } else if (err === 'network' || err === 'ne') {
        setError('Speech recognition requires Chrome or Edge browser and an internet connection.');
      } else if (err === 'audio-capture') {
        setError('No microphone detected. Please check your audio input device.');
      } else if (err !== 'no-speech' && err !== 'aborted') {
        setError('Speech recognition failed. Please use Chrome or Edge and try again.');
      }
      stopRecording();
    };

    recognition.onend = () => {
      setState('idle');
      recognitionRef.current = null;
    };

    try {
      recognition.start();
      recognitionRef.current = recognition;
      setState('recording');
    } catch (err) {
      console.error('Failed to start speech recognition:', err);
      setError('Failed to start speech recognition.');
    }
  }, [onTranscript, stopRecording]);

  const handleClick = (e) => {
    if (e) {
      e.preventDefault();
      e.stopPropagation();
    }

    // Debounce for mobile double-tap
    const now = Date.now();
    if (now - lastTapRef.current < 300) return;
    lastTapRef.current = now;

    if (!isSupported) {
      alert('Your browser does not support Speech Recognition.\nPlease use Chrome or Edge.');
      return;
    }

    if (state === 'idle') {
      startRecording();
    } else {
      stopRecording();
    }
  };

  // Update tooltip position when error appears
  useEffect(() => {
    if (error && buttonRef.current) {
      const rect = buttonRef.current.getBoundingClientRect();
      setTooltipPos({ top: rect.top - 8, right: window.innerWidth - rect.right });
    } else {
      setTooltipPos(null);
    }
  }, [error]);

  // Clean up on unmount
  useEffect(() => {
    return () => {
      if (recognitionRef.current) {
        recognitionRef.current.stop();
      }
    };
  }, []);

  const isRecording = state === 'recording';

  return (
    <div className="relative" onMouseDown={(e) => e.stopPropagation()} onTouchStart={(e) => e.stopPropagation()}>
      <button
        ref={buttonRef}
        type="button"
        style={{
          backgroundColor: isRecording ? '#22c55e' : '#374151'
        }}
        className={`
          flex items-center justify-center
          rounded-full
          text-white transition-all duration-200
          focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-green-400
          dark:ring-offset-gray-800
          touch-action-manipulation
          cursor-pointer
          hover:opacity-90
          ${className || 'w-12 h-12'}
        `}
        onMouseDown={handleClick}
        onTouchStart={handleClick}
        title={isRecording ? 'Stop recording' : 'Start voice input'}
      >
        <Mic className={`w-5 h-5 ${isRecording ? 'animate-pulse text-white' : 'text-gray-300'}`} />
      </button>

      {error && tooltipPos && createPortal(
        <div
          className="bg-red-500 text-white text-xs px-2 py-1 rounded z-50
                     animate-fade-in w-max max-w-[260px]"
          style={{
            position: 'fixed',
            top: tooltipPos.top,
            right: tooltipPos.right,
            transform: 'translateY(-100%)',
            pointerEvents: 'none',
          }}
        >
          {error}
        </div>,
        document.body
      )}

      {isRecording && (
        <div className="absolute -inset-1 rounded-full border-2 border-green-400 animate-ping pointer-events-none" />
      )}
    </div>
  );
}
