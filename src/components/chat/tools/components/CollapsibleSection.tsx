import React from 'react';

interface CollapsibleSectionProps {
  title: string;
  toolName?: string;
  open?: boolean;
  action?: React.ReactNode;
  onTitleClick?: () => void;
  children: React.ReactNode;
  className?: string;
}

/**
 * Reusable collapsible section with consistent styling
 */
export const CollapsibleSection: React.FC<CollapsibleSectionProps> = ({
  title,
  toolName,
  open = false,
  action,
  onTitleClick,
  children,
  className = ''
}) => {
  return (
    <details className={`relative group/details ${className}`} open={open}>
      <summary className="flex items-center gap-2 text-[13px] cursor-pointer py-1 select-none group-open/details:sticky group-open/details:top-0 group-open/details:z-10 group-open/details:bg-background group-open/details:-mx-1 group-open/details:px-1">
        <svg
          className="w-3.5 h-3.5 text-gray-400 dark:text-gray-600 transition-transform duration-150 group-open/details:rotate-90 flex-shrink-0"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
        </svg>
        {toolName && (
          <span className="font-bold text-gray-800 dark:text-gray-200 flex-shrink-0">{toolName}</span>
        )}
        {toolName && (
          <span className="text-gray-300 dark:text-gray-700 text-[10px] flex-shrink-0 mx-0.5">|</span>
        )}
        {onTitleClick ? (
          <button
            onClick={(e) => { e.preventDefault(); e.stopPropagation(); onTitleClick(); }}
            className="text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300 font-mono hover:underline truncate flex-1 text-left transition-colors font-medium"
          >
            {title}
          </button>
        ) : (
          <span className="text-gray-600 dark:text-gray-400 truncate flex-1 font-medium">
            {title}
          </span>
        )}
        {action && <span className="flex-shrink-0 ml-1">{action}</span>}
      </summary>
      <div className="mt-2.5 pl-5 border-t border-gray-100 dark:border-gray-800 pt-3">
        {children}
      </div>
    </details>
  );
};
