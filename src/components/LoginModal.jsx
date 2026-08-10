import { X } from 'lucide-react';

/**
 * Reusable notice modal for agent CLI authentication.
 *
 * @param {Object} props
 * @param {boolean} props.isOpen - Whether the modal is visible
 * @param {Function} props.onClose - Callback when modal is closed
 * @param {'claude'} props.provider - Which CLI provider to authenticate with
 * @param {Object} props.project - Project object containing name and path information
 * @param {Function} props.onComplete - Callback when login process completes (receives exitCode)
 * @param {string} props.customCommand - Optional custom command to override defaults
 * @param {boolean} props.isAuthenticated - Whether user is already authenticated (for re-auth flow)
 */
function LoginModal({
  isOpen,
  onClose,
  provider = 'claude',
  project,
  onComplete,
  customCommand,
  isAuthenticated = false,
  isOnboarding = false,
  cliAvailable = true,
  installHint = null
}) {
  if (!isOpen) return null;

  const getTitle = () => 'MedHelp Agent Login';

  if (!cliAvailable) {
    return (
      <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-[9999] max-md:items-stretch max-md:justify-stretch">
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl w-full max-w-lg flex flex-col md:rounded-lg md:m-4 max-md:max-w-none max-md:h-full max-md:rounded-none max-md:m-0">
          <div className="flex items-center justify-between p-4 border-b border-gray-200 dark:border-gray-700">
            <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
              {getTitle()}
            </h3>
            <button
              onClick={onClose}
              className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
              aria-label="Close login modal"
            >
              <X className="w-6 h-6" />
            </button>
          </div>
          <div className="p-6 space-y-3">
            <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-900/40 dark:bg-amber-950/30 dark:text-amber-200">
              {installHint || 'Required CLI is not installed. Install it first, then retry login.'}
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-[9999] max-md:items-stretch max-md:justify-stretch">
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl w-full max-w-lg flex flex-col md:rounded-lg md:m-4 max-md:max-w-none max-md:h-full max-md:rounded-none max-md:m-0">
        <div className="flex items-center justify-between p-4 border-b border-gray-200 dark:border-gray-700">
          <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
            {getTitle()}
          </h3>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
            aria-label="Close login modal"
          >
            <X className="w-6 h-6" />
          </button>
        </div>
        <div className="p-6 space-y-4">
          <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm leading-6 text-amber-800 dark:border-amber-900/40 dark:bg-amber-950/30 dark:text-amber-200">
            In-browser CLI login is disabled because it requires server-side command execution. Authenticate the Claude CLI directly on the server, then restart MedHelp.
          </div>
          <div className="rounded-lg border border-gray-200 bg-gray-50 px-4 py-3 text-xs leading-6 text-gray-700 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-300">
            Run <code className="rounded bg-white px-1.5 py-0.5 font-mono dark:bg-gray-800">claude /login</code> from a trusted server shell, or configure provider credentials with environment variables.
          </div>
          <div className="flex justify-end">
            <button
              type="button"
              onClick={onClose}
              className="rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-800 dark:bg-gray-100 dark:text-gray-900 dark:hover:bg-white"
            >
              Close
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default LoginModal;
