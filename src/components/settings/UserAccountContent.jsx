import React, { useEffect, useState } from 'react';
import { HardDrive, LockKeyhole, LogIn, LogOut, RefreshCcw, UserPlus } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../../contexts/AuthContext';
import { api } from '../../utils/api';
import UserAvatar from '../user-avatar/UserAvatar';
import UserAvatarPicker from './UserAvatarPicker';
import ProjectActivityCalendar from './ProjectActivityCalendar';

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function formatUsageBytes(bytes) {
  const value = Number(bytes || 0);
  if (!Number.isFinite(value) || value <= 0) return '0 MB';
  const mb = value / (1024 * 1024);
  if (mb < 1024) return `${mb.toFixed(mb >= 10 ? 0 : 1)} MB`;
  const gb = mb / 1024;
  return `${gb.toFixed(gb >= 10 ? 1 : 2)} GB`;
}

export default function UserAccountContent() {
  const { t } = useTranslation(['settings', 'auth']);
  const { user, login, register, logout, refreshUser } = useAuth();
  const [mode, setMode] = useState('login');
  const [username, setUsername] = useState('');
  const [notificationEmail, setNotificationEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const [showAuthForm, setShowAuthForm] = useState(() => !user);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmNewPassword, setConfirmNewPassword] = useState('');
  const [passwordLoading, setPasswordLoading] = useState(false);
  const [passwordStatus, setPasswordStatus] = useState(null);
  const [showPasswordForm, setShowPasswordForm] = useState(false);
  const [selectedAvatarId, setSelectedAvatarId] = useState(user?.avatarId || '');
  const [avatarLoading, setAvatarLoading] = useState(false);
  const [avatarStatus, setAvatarStatus] = useState(null);
  const [avatarPickerKey, setAvatarPickerKey] = useState(0);

  const isRegisterMode = mode === 'register';
  const displayName = user?.username || t('userAccount.currentUserFallback');
  const email = user?.notificationEmail || user?.email || '';
  const usage = user?.usage || {};
  const usagePercent = Math.min(100, Math.max(0, Number(usage.usagePercent ?? user?.usagePercent ?? 0) || 0));
  const isUsageExceeded = Boolean(usage.isUsageExceeded ?? user?.isUsageExceeded);
  const usageEnabled = usage.enabled !== false;

  useEffect(() => {
    setSelectedAvatarId(user?.avatarId || '');
  }, [user?.avatarId]);

  const resetForm = () => {
    setUsername('');
    setNotificationEmail('');
    setPassword('');
    setConfirmPassword('');
    setError('');
    setIsLoading(false);
  };

  const resetPasswordForm = () => {
    setCurrentPassword('');
    setNewPassword('');
    setConfirmNewPassword('');
    setPasswordLoading(false);
  };

  const getPasswordErrorMessage = (rawError) => {
    if (rawError === 'Current password is incorrect') {
      return t('userAccount.password.errors.currentIncorrect');
    }

    if (rawError === 'Current password and new password are required') {
      return t('userAccount.password.errors.requiredFields');
    }

    if (rawError === 'New password must be at least 6 characters') {
      return t('userAccount.password.errors.passwordLength');
    }

    return rawError || t('userAccount.password.errors.updateFailed');
  };

  const switchMode = (nextMode) => {
    setMode(nextMode);
    resetForm();
  };

  const handleToggleSwitchAccount = () => {
    setShowPasswordForm(false);
    resetPasswordForm();
    setPasswordStatus(null);
    setShowAuthForm((previous) => {
      const nextValue = !previous;
      if (nextValue) {
        setMode('login');
      } else {
        resetForm();
      }
      return nextValue;
    });
  };

  const handleTogglePasswordForm = () => {
    setShowPasswordForm((previous) => {
      const nextValue = !previous;
      resetPasswordForm();
      setPasswordStatus(null);
      if (nextValue) {
        setShowAuthForm(false);
        resetForm();
      }
      return nextValue;
    });
  };

  const handleCancelPasswordChange = () => {
    resetPasswordForm();
    setPasswordStatus(null);
    setShowPasswordForm(false);
  };

  const handleLogout = () => {
    handleCancelPasswordChange();
    logout();
  };

  const handleSelectAvatar = async (avatarId) => {
    if (!user || !avatarId || avatarId === selectedAvatarId || avatarLoading) {
      return;
    }

    setAvatarLoading(true);
    setAvatarStatus(null);

    try {
      const response = await api.user.updateAvatar(avatarId);
      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        setAvatarStatus({
          success: false,
          message: data?.error || t('userAccount.avatar.errors.saveFailed'),
        });
        return;
      }

      const nextAvatarId = data?.profile?.avatarId || avatarId;
      setSelectedAvatarId(nextAvatarId);
      await refreshUser?.();
      setAvatarStatus({ success: true, message: t('userAccount.avatar.saved') });
      setAvatarPickerKey((previous) => previous + 1);
    } catch (avatarError) {
      console.error('Avatar update error:', avatarError);
      setAvatarStatus({ success: false, message: t('userAccount.avatar.errors.networkError') });
    } finally {
      setAvatarLoading(false);
    }
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    setError('');

    if (!username.trim() || !password) {
      setError(t('auth:login.errors.requiredFields'));
      return;
    }

    if (isRegisterMode) {
      if (password !== confirmPassword) {
        setError(t('auth:register.errors.passwordMismatch'));
        return;
      }

      if (username.trim().length < 3) {
        setError(t('auth:register.errors.usernameLength'));
        return;
      }

      if (password.length < 6) {
        setError(t('auth:register.errors.passwordLength'));
        return;
      }

      if (!EMAIL_REGEX.test(notificationEmail.trim())) {
        setError(t('auth:register.errors.invalidEmail'));
        return;
      }

    }

    setIsLoading(true);

    const result = isRegisterMode
      ? await register(username.trim(), password, notificationEmail.trim())
      : await login(username.trim(), password);

    if (!result.success) {
      setError(result.error);
      setIsLoading(false);
      return;
    }

    resetForm();
    setMode('login');
    setShowAuthForm(Boolean(result.pendingReview));
    if (result.pendingReview) {
      setError(t('auth:register.pendingReview'));
    }
  };

  const handleChangePassword = async (event) => {
    event.preventDefault();
    setPasswordStatus(null);

    if (!currentPassword || !newPassword || !confirmNewPassword) {
      setPasswordStatus({ success: false, message: t('userAccount.password.errors.requiredFields') });
      return;
    }

    if (newPassword.length < 6) {
      setPasswordStatus({ success: false, message: t('userAccount.password.errors.passwordLength') });
      return;
    }

    if (newPassword !== confirmNewPassword) {
      setPasswordStatus({ success: false, message: t('userAccount.password.errors.passwordMismatch') });
      return;
    }

    setPasswordLoading(true);

    try {
      const response = await api.user.changePassword(currentPassword, newPassword);
      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        setPasswordStatus({
          success: false,
          message: getPasswordErrorMessage(data?.error),
        });
        return;
      }

      resetPasswordForm();
      setPasswordStatus({ success: true, message: t('userAccount.password.success') });
      setShowPasswordForm(false);
    } catch (changeError) {
      console.error('Password update error:', changeError);
      setPasswordStatus({ success: false, message: t('userAccount.password.errors.networkError') });
    } finally {
      setPasswordLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-3">
          <div className="rounded-lg border border-blue-200 bg-blue-50 p-2 text-blue-600 dark:border-blue-900/60 dark:bg-blue-950/40 dark:text-blue-300">
            <LogIn className="w-4 h-4" />
          </div>
          <div>
            <h3 className="text-lg font-semibold text-foreground">{t('userAccount.title')}</h3>
            <p className="text-sm text-muted-foreground">{t('userAccount.description')}</p>
          </div>
          <span className="ml-auto inline-flex items-center rounded-full border border-border/70 bg-muted/50 px-2.5 py-1 text-xs font-medium text-muted-foreground">
            {user ? t('userAccount.status.loggedIn') : t('userAccount.status.loggedOut')}
          </span>
        </div>
      </div>

      {user && (
        <div className="rounded-xl border border-gray-200 bg-gray-50 p-4 dark:border-gray-800 dark:bg-gray-900/40 md:p-5">
          <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
            <div className="flex min-w-0 items-start gap-4">
              <UserAvatar
                avatarId={selectedAvatarId || user?.avatarId}
                seed={displayName}
                size={64}
                label={t('userAccount.avatar.currentLabel', { username: displayName })}
                className="mt-0.5"
              />
              <div className="min-w-0 space-y-2">
                <div className="text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground/80">
                  {t('userAccount.currentAccount')}
                </div>
                <div className="truncate text-base font-semibold text-foreground">{displayName}</div>
                <div className="truncate text-sm text-muted-foreground">
                  {email || t('userAccount.noNotificationEmail')}
                </div>
                {usageEnabled && (
                  <div className="mt-2 w-full max-w-md rounded-lg border border-border bg-background/80 p-3">
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex min-w-0 items-center gap-2">
                        <HardDrive className="h-4 w-4 flex-shrink-0 text-muted-foreground" />
                        <span className="truncate text-sm font-medium text-foreground">
                          {t('userAccount.usage.title')}
                        </span>
                      </div>
                      <span className={`text-xs font-semibold ${isUsageExceeded ? 'text-red-600 dark:text-red-300' : 'text-muted-foreground'}`}>
                        {usagePercent.toFixed(usagePercent >= 10 ? 0 : 1)}%
                      </span>
                    </div>
                    <div className="mt-2 h-2 rounded-full bg-muted">
                      <div
                        className={`h-2 rounded-full ${isUsageExceeded ? 'bg-red-500' : usagePercent >= 80 ? 'bg-amber-500' : 'bg-emerald-500'}`}
                        style={{ width: `${usagePercent}%` }}
                      />
                    </div>
                    <div className="mt-2 grid gap-1 text-xs text-muted-foreground sm:grid-cols-3">
                      <span>{t('userAccount.usage.used')}: {formatUsageBytes(usage.usedBytes ?? user?.usageUsedBytes)}</span>
                      <span>{t('userAccount.usage.quota')}: {formatUsageBytes(usage.quotaBytes ?? user?.usageQuotaBytes)}</span>
                      <span className={isUsageExceeded ? 'font-semibold text-red-600 dark:text-red-300' : ''}>
                        {t('userAccount.usage.remaining')}: {formatUsageBytes(usage.remainingBytes ?? user?.usageRemainingBytes)}
                      </span>
                    </div>
                  </div>
                )}
                <p className="pt-1 text-sm text-muted-foreground">
                  {t('userAccount.switchHint')}
                </p>
              </div>
            </div>

            <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap md:justify-end">
              <button
                type="button"
                onClick={handleTogglePasswordForm}
                disabled={passwordLoading}
                aria-expanded={showPasswordForm}
                className={`inline-flex items-center justify-center gap-2 rounded-lg border px-4 py-2.5 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${
                  showPasswordForm
                    ? 'border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 dark:border-emerald-900/60 dark:bg-emerald-950/30 dark:text-emerald-300 dark:hover:bg-emerald-950/50'
                    : 'border-border bg-background text-foreground hover:bg-accent'
                }`}
              >
                <LockKeyhole className="h-4 w-4" />
                {t('userAccount.password.title')}
              </button>
              <button
                type="button"
                onClick={handleToggleSwitchAccount}
                disabled={passwordLoading}
                className="inline-flex items-center justify-center gap-2 rounded-lg border border-border bg-background px-4 py-2.5 text-sm font-medium text-foreground transition-colors hover:bg-accent disabled:cursor-not-allowed disabled:opacity-60"
              >
                <RefreshCcw className="w-4 h-4" />
                {t('userAccount.actions.switchAccount')}
              </button>
              <button
                type="button"
                onClick={handleLogout}
                disabled={passwordLoading}
                className="inline-flex items-center justify-center gap-2 rounded-lg border border-red-200 bg-red-50 px-4 py-2.5 text-sm font-medium text-red-700 transition-colors hover:bg-red-100 disabled:cursor-not-allowed disabled:opacity-60 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-300 dark:hover:bg-red-950/50"
              >
                <LogOut className="w-4 h-4" />
                {t('userAccount.actions.logout')}
              </button>
            </div>
          </div>

          {passwordStatus && (
            <div className={`mt-4 rounded-lg border px-3 py-2 text-sm ${
              passwordStatus.success
                ? 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900/60 dark:bg-emerald-950/30 dark:text-emerald-300'
                : 'border-red-200 bg-red-50 text-red-700 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-300'
            }`}>
              {passwordStatus.message}
            </div>
          )}

          {showPasswordForm && (
            <div className="mt-4 border-t border-border/70 pt-4">
              <p className="text-sm text-muted-foreground">{t('userAccount.password.description')}</p>
              <form onSubmit={handleChangePassword} className="mt-4 grid gap-4 md:grid-cols-3">
                <div>
                  <label htmlFor="settings-current-password" className="mb-1 block text-sm font-medium text-foreground">
                    {t('userAccount.password.current')}
                  </label>
                  <input
                    id="settings-current-password"
                    type="password"
                    autoComplete="current-password"
                    value={currentPassword}
                    onChange={(event) => setCurrentPassword(event.target.value)}
                    className="w-full rounded-lg border border-border bg-background px-3 py-2.5 text-sm text-foreground focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                    placeholder={t('userAccount.password.placeholders.current')}
                    disabled={passwordLoading}
                  />
                </div>

                <div>
                  <label htmlFor="settings-new-password" className="mb-1 block text-sm font-medium text-foreground">
                    {t('userAccount.password.new')}
                  </label>
                  <input
                    id="settings-new-password"
                    type="password"
                    autoComplete="new-password"
                    value={newPassword}
                    onChange={(event) => setNewPassword(event.target.value)}
                    className="w-full rounded-lg border border-border bg-background px-3 py-2.5 text-sm text-foreground focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                    placeholder={t('userAccount.password.placeholders.new')}
                    disabled={passwordLoading}
                  />
                </div>

                <div>
                  <label htmlFor="settings-confirm-new-password" className="mb-1 block text-sm font-medium text-foreground">
                    {t('userAccount.password.confirm')}
                  </label>
                  <input
                    id="settings-confirm-new-password"
                    type="password"
                    autoComplete="new-password"
                    value={confirmNewPassword}
                    onChange={(event) => setConfirmNewPassword(event.target.value)}
                    className="w-full rounded-lg border border-border bg-background px-3 py-2.5 text-sm text-foreground focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                    placeholder={t('userAccount.password.placeholders.confirm')}
                    disabled={passwordLoading}
                  />
                </div>

                <div className="flex flex-col gap-3 pt-1 md:col-span-3 sm:flex-row sm:items-center">
                  <button
                    type="submit"
                    disabled={passwordLoading}
                    className="inline-flex items-center justify-center gap-2 rounded-lg bg-emerald-600 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-emerald-700 disabled:cursor-not-allowed disabled:bg-emerald-400"
                  >
                    <LockKeyhole className="h-4 w-4" />
                    {passwordLoading ? t('userAccount.password.loading') : t('userAccount.password.submit')}
                  </button>
                  <button
                    type="button"
                    onClick={handleCancelPasswordChange}
                    disabled={passwordLoading}
                    className="inline-flex items-center justify-center rounded-lg border border-border bg-background px-4 py-2.5 text-sm font-medium text-foreground transition-colors hover:bg-accent disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {t('actions.cancelChanges')}
                  </button>
                </div>
              </form>
            </div>
          )}

          <div className="mt-5 border-t border-border/70 pt-5">
            <UserAvatarPicker
              key={avatarPickerKey}
              selectedAvatarId={selectedAvatarId || user?.avatarId}
              seed={displayName}
              disabled={avatarLoading}
              onSelect={handleSelectAvatar}
            />

            {avatarStatus && (
              <div className={`mt-4 rounded-lg border px-3 py-2 text-sm ${
                avatarStatus.success
                  ? 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900/60 dark:bg-emerald-950/30 dark:text-emerald-300'
                  : 'border-red-200 bg-red-50 text-red-700 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-300'
              }`}>
                {avatarStatus.message}
              </div>
            )}
          </div>

          <div className="mt-5 border-t border-border/70 pt-5">
            <ProjectActivityCalendar />
          </div>
        </div>
      )}

      {(!user || showAuthForm) && (
        <div className="rounded-xl border border-border bg-card p-4 shadow-sm md:p-6">
          <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
            <div>
              <h4 className="text-base font-semibold text-foreground">
                {isRegisterMode
                  ? t('auth:register.title')
                  : user
                    ? t('userAccount.switchFormTitle')
                    : t('auth:login.title')}
              </h4>
              <p className="mt-1 text-sm text-muted-foreground">
                {isRegisterMode
                  ? t('auth:register.description')
                  : user
                    ? t('userAccount.switchFormDescription')
                    : t('auth:login.description')}
              </p>
            </div>

            <div className="inline-flex w-fit rounded-lg border border-border/70 bg-muted/40 p-1">
              <button
                type="button"
                onClick={() => switchMode('login')}
                className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                  !isRegisterMode
                    ? 'bg-background text-foreground shadow-sm'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                {t('userAccount.mode.login')}
              </button>
              <button
                type="button"
                onClick={() => switchMode('register')}
                className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                  isRegisterMode
                    ? 'bg-background text-foreground shadow-sm'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                {t('userAccount.mode.register')}
              </button>
            </div>
          </div>

          {user && !isRegisterMode && (
            <div className="mt-4 rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-sm text-blue-700 dark:border-blue-900/50 dark:bg-blue-950/30 dark:text-blue-300">
              {t('userAccount.replaceSessionHint')}
            </div>
          )}

          {error && (
            <div className="mt-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-300">
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit} className="mt-5 space-y-4">
            <div>
              <label htmlFor="settings-account-username" className="mb-1 block text-sm font-medium text-foreground">
                {isRegisterMode ? t('auth:register.username') : t('auth:login.username')}
              </label>
              <input
                id="settings-account-username"
                type="text"
                autoComplete="username"
                value={username}
                onChange={(event) => setUsername(event.target.value)}
                className="w-full rounded-lg border border-border bg-background px-3 py-2.5 text-sm text-foreground focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                placeholder={
                  isRegisterMode
                    ? t('auth:register.placeholders.username')
                    : t('auth:login.placeholders.username')
                }
                disabled={isLoading}
              />
            </div>

            {isRegisterMode && (
              <div>
                <label htmlFor="settings-account-email" className="mb-1 block text-sm font-medium text-foreground">
                  {t('auth:register.email')}
                </label>
                <input
                  id="settings-account-email"
                  type="email"
                  autoComplete="email"
                  value={notificationEmail}
                  onChange={(event) => setNotificationEmail(event.target.value)}
                  className="w-full rounded-lg border border-border bg-background px-3 py-2.5 text-sm text-foreground focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                  placeholder={t('auth:register.placeholders.email')}
                  disabled={isLoading}
                />
              </div>
            )}

            <div>
              <label htmlFor="settings-account-password" className="mb-1 block text-sm font-medium text-foreground">
                {isRegisterMode ? t('auth:register.password') : t('auth:login.password')}
              </label>
              <input
                id="settings-account-password"
                type="password"
                autoComplete={isRegisterMode ? 'new-password' : 'current-password'}
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                className="w-full rounded-lg border border-border bg-background px-3 py-2.5 text-sm text-foreground focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                placeholder={
                  isRegisterMode
                    ? t('auth:register.placeholders.password')
                    : t('auth:login.placeholders.password')
                }
                disabled={isLoading}
              />
            </div>

            {isRegisterMode && (
              <div>
                <label htmlFor="settings-account-confirm-password" className="mb-1 block text-sm font-medium text-foreground">
                  {t('auth:register.confirmPassword')}
                </label>
                <input
                  id="settings-account-confirm-password"
                  type="password"
                  autoComplete="new-password"
                  value={confirmPassword}
                  onChange={(event) => setConfirmPassword(event.target.value)}
                  className="w-full rounded-lg border border-border bg-background px-3 py-2.5 text-sm text-foreground focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                  placeholder={t('auth:register.placeholders.confirmPassword')}
                  disabled={isLoading}
                />
              </div>
            )}

            <div className="flex flex-col gap-3 pt-1 sm:flex-row sm:items-center">
              <button
                type="submit"
                disabled={isLoading}
                className="inline-flex items-center justify-center gap-2 rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-blue-400"
              >
                {isRegisterMode ? <UserPlus className="w-4 h-4" /> : <LogIn className="w-4 h-4" />}
                {isLoading
                  ? (isRegisterMode ? t('auth:register.loading') : t('auth:login.loading'))
                  : (isRegisterMode ? t('auth:register.submit') : t('auth:login.submit'))}
              </button>

              {user && (
                <button
                  type="button"
                  onClick={handleToggleSwitchAccount}
                  className="inline-flex items-center justify-center rounded-lg border border-border bg-background px-4 py-2.5 text-sm font-medium text-foreground transition-colors hover:bg-accent"
                >
                  {t('actions.cancelChanges')}
                </button>
              )}
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
