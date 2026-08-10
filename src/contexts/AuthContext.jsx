import { createContext, useContext } from 'react';

// Kept as a tiny compatibility context because several core workflow providers
// still expect a user-shaped owner. It has no account, login, quota, or network
// behavior; the app is a local single-user workspace.
const LOCAL_USER = {
  id: 'local',
  username: 'local',
};

const AuthContext = createContext({
  user: LOCAL_USER,
  token: 'local',
  isLoading: false,
  needsSetup: false,
  hasCompletedOnboarding: true,
  login: async () => ({ success: false }),
  register: async () => ({ success: false }),
  logout: () => undefined,
  refreshOnboardingStatus: async () => undefined,
  refreshUser: async () => LOCAL_USER,
  error: null,
});

export const useAuth = () => useContext(AuthContext);

export const AuthProvider = ({ children }) => (
  <AuthContext.Provider value={{
    user: LOCAL_USER,
    token: 'local',
    isLoading: false,
    needsSetup: false,
    hasCompletedOnboarding: true,
    login: async () => ({ success: false }),
    register: async () => ({ success: false }),
    logout: () => undefined,
    refreshOnboardingStatus: async () => undefined,
    refreshUser: async () => LOCAL_USER,
    error: null,
  }}>
    {children}
  </AuthContext.Provider>
);
