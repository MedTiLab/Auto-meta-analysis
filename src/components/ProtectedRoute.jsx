import React from 'react';
import { useAuth } from '../contexts/AuthContext';
import SetupForm from './SetupForm';
import LoginForm from './LoginForm';
import Onboarding from './Onboarding';
import { IS_PLATFORM } from '../constants/config';

const LoadingScreen = () => (
  <div className="min-h-screen bg-background flex items-center justify-center p-4">
    <div className="text-center">
      <div className="flex justify-center mb-4">
        <div className="w-16 h-16 rounded-2xl overflow-hidden shadow-sm ring-1 ring-border/40 bg-background">
          <img
            src="/logo.png"
            alt="MedHelp"
            className="w-full h-full object-cover"
            loading="eager"
          />
        </div>
      </div>
      <h1 className="text-2xl font-bold text-foreground mb-2">MedHelp®</h1>
      <div className="flex items-center justify-center space-x-2">
        <div className="w-2 h-2 bg-blue-500 rounded-full animate-bounce"></div>
        <div className="w-2 h-2 bg-blue-500 rounded-full animate-bounce" style={{ animationDelay: '0.1s' }}></div>
        <div className="w-2 h-2 bg-blue-500 rounded-full animate-bounce" style={{ animationDelay: '0.2s' }}></div>
      </div>
      <p className="text-muted-foreground mt-2">Loading...</p>
    </div>
  </div>
);

const ProtectedRoute = ({ children }) => {
  const { isLoading, needsSetup, user, hasCompletedOnboarding, refreshOnboardingStatus } = useAuth();

  if (isLoading) {
    return <LoadingScreen />;
  }

  if (needsSetup) {
    return <SetupForm />;
  }

  if (!user) {
    return <LoginForm />;
  }

  if (!hasCompletedOnboarding) {
    return <Onboarding onComplete={refreshOnboardingStatus} />;
  }

  return children;
};

export default ProtectedRoute;
