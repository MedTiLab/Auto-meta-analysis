import { useTranslation } from 'react-i18next';

type TokenUsagePieProps = {
  used?: number | null;
  total?: number | null;
  estimated?: boolean;
  unsupportedContext?: boolean;
  message?: string;
  showUnavailable?: boolean;
};

export default function TokenUsagePie({ used, total, estimated, unsupportedContext, message, showUnavailable = true }: TokenUsagePieProps) {
  const { t } = useTranslation('chat');

  if (unsupportedContext) {
    if (!showUnavailable) {
      return null;
    }

    return (
      <div
        className="flex items-center gap-2 text-xs text-gray-600 dark:text-gray-400"
        title={message || t('tokenUsage.unavailableTitle', { defaultValue: 'Current context usage is unavailable for this session.' })}
      >
        <span className="rounded-full border border-border/70 px-2 py-0.5 font-medium">
          {t('tokenUsage.unavailable', { defaultValue: 'Context N/A' })}
        </span>
      </div>
    );
  }

  // Token usage visualization component
  // Only bail out on missing values or non‐positive totals; allow used===0 to render 0%
  if (used == null || total == null || total <= 0) return null;

  const percentage = Math.min(100, (used / total) * 100);
  const radius = 10;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (percentage / 100) * circumference;
  const baseTitle = `${used.toLocaleString()} / ${total.toLocaleString()} tokens`;
  const titleText = estimated && message
    ? `${baseTitle}\n${message}`
    : (message || baseTitle);

  // Color based on usage level
  const getColor = () => {
    if (percentage < 50) return '#3b82f6'; // blue
    if (percentage < 75) return '#f59e0b'; // orange
    return '#ef4444'; // red
  };

  return (
    <div className="flex items-center gap-2 text-xs text-gray-600 dark:text-gray-400">
      <svg width="24" height="24" viewBox="0 0 24 24" className="transform -rotate-90">
        {/* Background circle */}
        <circle
          cx="12"
          cy="12"
          r={radius}
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          className="text-gray-300 dark:text-gray-600"
        />
        {/* Progress circle */}
        <circle
          cx="12"
          cy="12"
          r={radius}
          fill="none"
          stroke={getColor()}
          strokeWidth="2"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          strokeLinecap="round"
        />
      </svg>
      <span title={titleText}>
        {percentage.toFixed(1)}%
      </span>
    </div>
  );
}
