import React, { useEffect, useRef, useState } from 'react';
import { Check, ChevronLeft, ChevronRight, FileText, Loader2, LogIn } from 'lucide-react';
import ClaudeLogo from './ClaudeLogo';
import LoginModal from './LoginModal';
import { authenticatedFetch } from '../utils/api';
import { IS_PLATFORM } from '../constants/config';
import { isTelemetryEnabled, setTelemetryEnabled } from '../utils/telemetry';
import { writeCliAvailability } from '../utils/cliAvailability';

const buildDefaultAuthState = (overrides = {}) => ({
  authenticated: false,
  email: null,
  cliAvailable: true,
  cliCommand: 'claude',
  installHint: null,
  loading: false,
  error: null,
  ...overrides,
});

const Onboarding = ({ onComplete }) => {
  const [currentStep, setCurrentStep] = useState(0);
  const [telemetryConsent, setTelemetryConsentState] = useState(() => isTelemetryEnabled());
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [activeLoginProvider, setActiveLoginProvider] = useState(null);
  const [selectedProject] = useState({ name: 'default', fullPath: IS_PLATFORM ? '/workspace' : '' });
  const [claudeAuthStatus, setClaudeAuthStatus] = useState(buildDefaultAuthState({ loading: true }));
  const prevActiveLoginProviderRef = useRef(undefined);

  const checkClaudeAuthStatus = async () => {
    try {
      const response = await authenticatedFetch('/api/cli/claude/status');
      if (!response.ok) {
        setClaudeAuthStatus(buildDefaultAuthState({ error: 'Failed to check authentication status' }));
        return;
      }

      const data = await response.json();
      const nextStatus = {
        authenticated: Boolean(data.authenticated),
        email: data.email || null,
        cliAvailable: data.cliAvailable !== false,
        cliCommand: data.cliCommand || 'claude',
        installHint: data.installHint || null,
        loading: false,
        error: data.error || null,
      };
      setClaudeAuthStatus(nextStatus);
      writeCliAvailability('claude', {
        cliAvailable: nextStatus.cliAvailable,
        cliCommand: nextStatus.cliCommand,
        installHint: nextStatus.installHint,
      });
    } catch (statusError) {
      console.error('Error checking Claude auth status:', statusError);
      setClaudeAuthStatus(buildDefaultAuthState({ error: statusError.message }));
    }
  };

  useEffect(() => {
    const prevProvider = prevActiveLoginProviderRef.current;
    prevActiveLoginProviderRef.current = activeLoginProvider;

    const isInitialMount = prevProvider === undefined;
    const isModalClosing = prevProvider !== null && activeLoginProvider === null;
    if (isInitialMount || isModalClosing) {
      checkClaudeAuthStatus();
    }
  }, [activeLoginProvider]);

  const handleLoginComplete = (exitCode) => {
    if (exitCode === 0) {
      checkClaudeAuthStatus();
    }
  };

  const handleNextStep = () => {
    setError('');
    if (currentStep === 0) {
      setTelemetryEnabled(telemetryConsent);
    }
    setCurrentStep((step) => step + 1);
  };

  const handlePrevStep = () => {
    setError('');
    setCurrentStep((step) => Math.max(0, step - 1));
  };

  const handleFinish = async () => {
    setIsSubmitting(true);
    setError('');

    try {
      const response = await authenticatedFetch('/api/user/complete-onboarding', {
        method: 'POST',
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Failed to complete onboarding');
      }

      onComplete?.();
    } catch (finishError) {
      setError(finishError.message);
    } finally {
      setIsSubmitting(false);
    }
  };

  const steps = [
    {
      title: 'Preferences',
      icon: FileText,
    },
    {
      title: 'Connect Claude',
      icon: LogIn,
    },
  ];

  const renderStepContent = () => {
    if (currentStep === 0) {
      return (
        <div className="space-y-6">
          <div className="text-center mb-6">
            <div className="w-16 h-16 bg-indigo-100 dark:bg-indigo-900/30 rounded-full flex items-center justify-center mx-auto mb-4">
              <FileText className="w-8 h-8 text-indigo-600 dark:text-indigo-400" />
            </div>
            <h2 className="text-2xl font-bold text-foreground mb-2">Welcome to MedAutoData</h2>
            <p className="text-muted-foreground">Configure your data usage preference before continuing.</p>
          </div>

          <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-900/40 dark:bg-amber-950/30 dark:text-amber-200">
            Internal beta agreement is temporarily disabled. Users can continue onboarding without accepting it.
          </div>

          <div className="space-y-3 rounded-lg border border-border bg-card p-4">
            <label className="flex items-start gap-3 text-sm text-foreground">
              <input
                type="checkbox"
                checked={telemetryConsent}
                onChange={(event) => setTelemetryConsentState(event.target.checked)}
                className="mt-0.5 h-4 w-4 rounded border-border text-blue-600 focus:ring-blue-500"
                disabled={isSubmitting}
              />
              <span>
                Allow my usage data to improve MedAutoData models and features. You can still continue without this and change it anytime in Settings.
              </span>
            </label>
          </div>
        </div>
      );
    }

    return (
      <div className="space-y-6">
        <div className="text-center mb-6">
          <h2 className="text-2xl font-bold text-foreground mb-2">Connect Claude</h2>
          <p className="text-muted-foreground">Claude is the only assistant runtime used by this Meta workflow.</p>
        </div>

        <div className={`border rounded-lg p-4 transition-colors ${
          claudeAuthStatus.authenticated
            ? 'bg-blue-50 dark:bg-blue-900/20 border-blue-200 dark:border-blue-800'
            : claudeAuthStatus.cliAvailable === false
              ? 'bg-amber-50 dark:bg-amber-950/20 border-amber-200 dark:border-amber-800'
              : 'border-border bg-card'
        }`}>
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-3 min-w-0">
              <div className="w-10 h-10 bg-blue-100 dark:bg-blue-900/30 rounded-full flex items-center justify-center shrink-0">
                <ClaudeLogo size={20} />
              </div>
              <div className="min-w-0">
                <div className="font-medium text-foreground flex items-center gap-2">
                  Claude Code
                  {claudeAuthStatus.authenticated && <Check className="w-4 h-4 text-green-500 shrink-0" />}
                </div>
                <div className="text-xs text-muted-foreground">
                  {claudeAuthStatus.loading
                    ? 'Checking...'
                    : claudeAuthStatus.cliAvailable === false
                      ? 'Install Claude CLI first'
                      : claudeAuthStatus.authenticated
                        ? claudeAuthStatus.email || 'Connected'
                        : 'Not connected'}
                </div>
                {claudeAuthStatus.cliAvailable === false && claudeAuthStatus.installHint && (
                  <p className="text-xs text-amber-800 dark:text-amber-200 mt-1">{claudeAuthStatus.installHint}</p>
                )}
              </div>
            </div>
            {!claudeAuthStatus.authenticated && !claudeAuthStatus.loading && claudeAuthStatus.cliAvailable !== false && (
              <button
                onClick={() => setActiveLoginProvider('claude')}
                className="shrink-0 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium py-2 px-4 rounded-lg transition-colors"
              >
                Login
              </button>
            )}
          </div>
        </div>

        <div className="text-center text-sm text-muted-foreground pt-2">
          <p>You can reconnect Claude later in Settings.</p>
        </div>
      </div>
    );
  };

  return (
    <>
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <div className="w-full max-w-2xl">
          <div className="mb-8">
            <div className="flex items-center justify-between">
              {steps.map((step, index) => (
                <React.Fragment key={step.title}>
                  <div className="flex flex-col items-center flex-1">
                    <div className={`w-12 h-12 rounded-full flex items-center justify-center border-2 transition-colors duration-200 ${
                      index < currentStep ? 'bg-green-500 border-green-500 text-white' :
                      index === currentStep ? 'bg-blue-600 border-blue-600 text-white' :
                      'bg-background border-border text-muted-foreground'
                    }`}>
                      {index < currentStep ? <Check className="w-6 h-6" /> : <step.icon className="w-6 h-6" />}
                    </div>
                    <div className="mt-2 text-center">
                      <p className={`text-sm font-medium ${
                        index === currentStep ? 'text-foreground' : 'text-muted-foreground'
                      }`}>
                        {step.title}
                      </p>
                    </div>
                  </div>
                  {index < steps.length - 1 && (
                    <div className={`flex-1 h-0.5 mx-2 transition-colors duration-200 ${
                      index < currentStep ? 'bg-green-500' : 'bg-border'
                    }`} />
                  )}
                </React.Fragment>
              ))}
            </div>
          </div>

          <div className="bg-card rounded-lg shadow-lg border border-border p-8">
            {renderStepContent()}

            {error && (
              <div className="mt-6 p-4 bg-red-100 dark:bg-red-900/20 border border-red-300 dark:border-red-800 rounded-lg">
                <p className="text-sm text-red-700 dark:text-red-400">{error}</p>
              </div>
            )}

            <div className="flex items-center justify-between mt-8 pt-6 border-t border-border">
              <button
                onClick={handlePrevStep}
                disabled={currentStep === 0 || isSubmitting}
                className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-muted-foreground hover:text-foreground disabled:opacity-50 disabled:cursor-not-allowed transition-colors duration-200"
              >
                <ChevronLeft className="w-4 h-4" />
                Previous
              </button>

              {currentStep < steps.length - 1 ? (
                <button
                  onClick={handleNextStep}
                  disabled={isSubmitting}
                  className="flex items-center gap-2 px-6 py-3 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 disabled:cursor-not-allowed text-white font-medium rounded-lg transition-colors duration-200"
                >
                  Next
                  <ChevronRight className="w-4 h-4" />
                </button>
              ) : (
                <button
                  onClick={handleFinish}
                  disabled={isSubmitting}
                  className="flex items-center gap-2 px-6 py-3 bg-green-600 hover:bg-green-700 disabled:bg-green-400 disabled:cursor-not-allowed text-white font-medium rounded-lg transition-colors duration-200"
                >
                  {isSubmitting ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      Completing...
                    </>
                  ) : (
                    <>
                      <Check className="w-4 h-4" />
                      Complete Setup
                    </>
                  )}
                </button>
              )}
            </div>
          </div>
        </div>
      </div>

      {activeLoginProvider && (
        <LoginModal
          isOpen={Boolean(activeLoginProvider)}
          onClose={() => setActiveLoginProvider(null)}
          provider="claude"
          project={selectedProject}
          onComplete={handleLoginComplete}
          isOnboarding={true}
          cliAvailable={claudeAuthStatus.cliAvailable !== false}
          installHint={claudeAuthStatus.installHint}
        />
      )}
    </>
  );
};

export default Onboarding;
