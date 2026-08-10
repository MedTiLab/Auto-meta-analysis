import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { ArrowRight, CheckCircle2, LockKeyhole, RefreshCcw, ShieldCheck, UserPlus } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import BrandLogo from './BrandLogo';
import { getLoginPageContent } from '../config/loginPage';

const inputClassName =
  'h-10 w-full rounded-md border border-[#d7d7d7] bg-white px-3 py-2 text-sm text-[#171717] shadow-sm caret-[#0e9f6e] placeholder:text-[#9ca3af] focus:border-transparent focus:outline-none focus:ring-2 focus:ring-[#0e9f6e] disabled:cursor-not-allowed disabled:bg-[#f3f4f6] disabled:text-[#6b7280] disabled:opacity-60';

const LoginForm = () => {
  const { t, i18n } = useTranslation('auth');
  const navigate = useNavigate();
  const [mode, setMode] = useState('login');
  const [username, setUsername] = useState('');
  const [notificationEmail, setNotificationEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const { login, register } = useAuth();

  const isRegisterMode = mode === 'register';
  const pageContent = getLoginPageContent(i18n.resolvedLanguage || i18n.language);
  const formDescription = isRegisterMode
    ? pageContent.form.registerDescription
    : pageContent.form.loginDescription;

  const switchMode = (nextMode) => {
    setMode(nextMode);
    setError('');
    setNotice('');
    setUsername('');
    setNotificationEmail('');
    setPassword('');
    setConfirmPassword('');
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setNotice('');

    if (!username || !password) {
      setError(t('login.errors.requiredFields'));
      return;
    }

    if (isRegisterMode) {
      if (password !== confirmPassword) {
        setError(t('register.errors.passwordMismatch'));
        return;
      }

      if (username.trim().length < 3) {
        setError(t('register.errors.usernameLength'));
        return;
      }

      if (password.length < 6) {
        setError(t('register.errors.passwordLength'));
        return;
      }

      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(notificationEmail.trim())) {
        setError(t('register.errors.invalidEmail'));
        return;
      }

    }

    setIsLoading(true);

    const result = isRegisterMode
      ? await register(username.trim(), password, notificationEmail.trim())
      : await login(username.trim(), password);

    if (!result.success) {
      setError(result.error);
    } else if (isRegisterMode && result.pendingReview) {
      setNotice(t('register.pendingReview'));
      setMode('login');
      setUsername('');
      setNotificationEmail('');
      setPassword('');
      setConfirmPassword('');
    }

    setIsLoading(false);
  };

  return (
    <div
      className="min-h-screen bg-[#f7f7f7] text-[#171717] md:grid md:grid-cols-[minmax(0,1.08fr)_minmax(420px,0.92fr)]"
      style={{ colorScheme: 'light' }}
    >
      <section
        className="flex min-h-[42vh] overflow-hidden px-6 py-8 text-white md:min-h-screen md:items-center md:px-10 lg:px-14"
        style={{
          backgroundColor: 'hsl(160 84% 35% / 0.82)',
          backgroundImage:
            'linear-gradient(135deg, hsl(160 84% 35% / 0.78), hsl(160 84% 35% / 0.58)), url("/images/login-hero-bg.png")',
          backgroundPosition: 'center',
          backgroundSize: 'cover',
        }}
      >
        <div className="mx-auto flex w-full max-w-2xl flex-col justify-between gap-10">
          <div className="space-y-8">
            <div className="flex items-center gap-3">
              <BrandLogo variant="transparent" className="h-10 w-32 opacity-[0.42] drop-shadow-sm" />
              <div>
                <p className="text-sm font-semibold text-white">{pageContent.brand}</p>
                <p className="text-xs text-white/75">{pageContent.eyebrow}</p>
              </div>
            </div>

            <div className="max-w-xl space-y-4">
              <h1 className="text-3xl font-semibold leading-tight md:text-4xl">
                {pageContent.title}
              </h1>
              <p className="text-base leading-7 text-white/86">
                {pageContent.description}
              </p>
            </div>

            <div className="space-y-3">
              {pageContent.highlights.map((item) => (
                <div key={item} className="flex items-start gap-3 text-sm leading-6 text-white/90">
                  <CheckCircle2 className="mt-0.5 h-4 w-4 flex-shrink-0 text-white/80" />
                  <span>{item}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-3 gap-3 border-t border-white/20 pt-5">
            {pageContent.metrics.map((metric) => (
              <div key={metric.label}>
                <div className="text-xl font-semibold">{metric.value}</div>
                <div className="mt-1 text-xs leading-5 text-white/78">{metric.label}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="flex min-h-[58vh] items-center justify-center px-4 py-8 md:min-h-screen md:px-8 lg:px-12">
        <div className="w-full max-w-[420px]">
          <div className="mb-6 space-y-3">
            <div className="inline-flex items-center gap-2 rounded-md border border-[#0e9f6e]/20 bg-[#0e9f6e]/10 px-3 py-1.5 text-sm font-medium text-[#0e9f6e]">
              <LockKeyhole className="h-4 w-4" />
              {pageContent.form.eyebrow}
            </div>
            <div>
              <h2 className="text-2xl font-semibold text-[#171717]">
                {isRegisterMode ? t('register.title') : t('login.title')}
              </h2>
              <p className="mt-2 text-sm leading-6 text-[#666666]">
                {formDescription}
              </p>
            </div>
          </div>

          <div className="rounded-lg border border-[#dedede] bg-white p-6 shadow-lg shadow-slate-950/5 md:p-7">
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label htmlFor="username" className="mb-1.5 block text-sm font-medium text-[#171717]">
                  {isRegisterMode ? t('register.username') : t('login.username')}
                </label>
                <input
                  type="text"
                  id="username"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  className={inputClassName}
                  placeholder={isRegisterMode ? t('register.placeholders.username') : t('login.placeholders.username')}
                  required
                  disabled={isLoading}
                />
              </div>

              <div>
                <label htmlFor="password" className="mb-1.5 block text-sm font-medium text-[#171717]">
                  {isRegisterMode ? t('register.password') : t('login.password')}
                </label>
                <input
                  type="password"
                  id="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className={inputClassName}
                  placeholder={isRegisterMode ? t('register.placeholders.password') : t('login.placeholders.password')}
                  required
                  disabled={isLoading}
                />
              </div>

              {isRegisterMode && (
                <div>
                  <label htmlFor="notificationEmail" className="mb-1.5 block text-sm font-medium text-[#171717]">
                    {t('register.email')}
                  </label>
                  <input
                    type="email"
                    id="notificationEmail"
                    value={notificationEmail}
                    onChange={(e) => setNotificationEmail(e.target.value)}
                    className={inputClassName}
                    placeholder={t('register.placeholders.email')}
                    required
                    disabled={isLoading}
                  />
                </div>
              )}

              {isRegisterMode && (
                <div>
                  <label htmlFor="confirmPassword" className="mb-1.5 block text-sm font-medium text-[#171717]">
                    {t('register.confirmPassword')}
                  </label>
                  <input
                    type="password"
                    id="confirmPassword"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    className={inputClassName}
                    placeholder={t('register.placeholders.confirmPassword')}
                    required
                    disabled={isLoading}
                  />
                </div>
              )}

              {error && (
                <div className="rounded-md border border-red-300 bg-red-50 p-3">
                  <p className="text-sm text-red-700">{error}</p>
                </div>
              )}

              {notice && (
                <div className="rounded-md border border-emerald-200 bg-emerald-50 p-3">
                  <p className="text-sm text-emerald-800">{notice}</p>
                </div>
              )}

              <button
                type="submit"
                disabled={isLoading}
                className="inline-flex h-10 w-full items-center justify-center gap-2 rounded-md bg-[#0e9f6e] px-4 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-[#0c8f63] disabled:bg-[#0e9f6e]/60"
              >
                {isLoading
                  ? (isRegisterMode ? t('register.loading') : t('login.loading'))
                  : (isRegisterMode ? t('register.submit') : t('login.submit'))}
                {!isLoading && <ArrowRight className="h-4 w-4" />}
              </button>
            </form>

            <div className="mt-5 border-t border-[#dedede] pt-5">
              <div className="flex items-start gap-3">
                <div className="mt-0.5 rounded-md border border-[#0e9f6e]/20 bg-[#0e9f6e]/10 p-2">
                  {isRegisterMode ? (
                    <RefreshCcw className="h-4 w-4 text-[#0e9f6e]" />
                  ) : (
                    <UserPlus className="h-4 w-4 text-[#0e9f6e]" />
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-[#171717]">
                    {isRegisterMode ? t('login.backToLoginTitle') : t('login.registerCard.title')}
                  </p>
                  <p className="mt-1 text-sm leading-5 text-[#666666]">
                    {isRegisterMode ? t('login.backToLoginDescription') : t('login.registerCard.description')}
                  </p>
                  <button
                    type="button"
                    onClick={() => switchMode(isRegisterMode ? 'login' : 'register')}
                    disabled={isLoading}
                    className="mt-3 inline-flex h-9 items-center gap-2 rounded-md border border-[#0e9f6e]/30 bg-[#f7f7f7] px-3 text-sm font-medium text-[#0e9f6e] hover:bg-[#0e9f6e]/10 disabled:opacity-50"
                  >
                    {isRegisterMode ? (
                      <>
                        <RefreshCcw className="h-4 w-4" />
                        {t('login.backToLoginButton')}
                      </>
                    ) : (
                      <>
                        <UserPlus className="h-4 w-4" />
                        {t('login.registerCard.button')}
                      </>
                    )}
                  </button>
                </div>
              </div>
            </div>

            <div className="mt-4 border-t border-[#dedede] pt-4">
              <button
                type="button"
                onClick={() => navigate('/admin')}
                disabled={isLoading}
                className="inline-flex h-9 w-full items-center justify-center gap-2 rounded-md border border-[#d7d7d7] bg-white px-3 text-sm font-medium text-[#444444] hover:bg-[#f7f7f7] disabled:opacity-50"
              >
                <ShieldCheck className="h-4 w-4 text-[#0e9f6e]" />
                {t('login.adminLoginButton')}
              </button>
            </div>
          </div>

          <p className="mt-5 text-center text-xs leading-5 text-[#666666]">
            {pageContent.form.securityNote}
          </p>
        </div>
      </section>
    </div>
  );
};

export default LoginForm;
