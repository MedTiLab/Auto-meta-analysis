import React, { useEffect, useMemo, useState } from 'react';
import { AlertCircle, CheckCircle2, HelpCircle, Send } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../../contexts/AuthContext';
import { api } from '../../utils/api';
import { Button } from '../ui/button';
import { Input } from '../ui/input';

const MAX_TITLE_LENGTH = 120;
const MAX_CONTENT_LENGTH = 4000;

export default function HelpFeedbackContent() {
  const { t, i18n } = useTranslation('settings');
  const { user } = useAuth();
  const defaultContact = user?.notificationEmail || user?.email || '';
  const [category, setCategory] = useState('suggestion');
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [contact, setContact] = useState(defaultContact);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [status, setStatus] = useState(null);

  const categoryOptions = useMemo(() => ([
    { value: 'suggestion', label: t('helpFeedback.categories.suggestion') },
    { value: 'bug', label: t('helpFeedback.categories.bug') },
    { value: 'question', label: t('helpFeedback.categories.question') },
    { value: 'other', label: t('helpFeedback.categories.other') },
  ]), [t]);

  useEffect(() => {
    if (!contact && defaultContact) {
      setContact(defaultContact);
    }
  }, [contact, defaultContact]);

  const handleSubmit = async (event) => {
    event.preventDefault();
    setStatus(null);

    if (!content.trim()) {
      setStatus({ type: 'error', message: t('helpFeedback.messages.required') });
      return;
    }

    if (content.length > MAX_CONTENT_LENGTH) {
      setStatus({ type: 'error', message: t('helpFeedback.messages.contentTooLong', { max: MAX_CONTENT_LENGTH }) });
      return;
    }

    setIsSubmitting(true);

    try {
      const response = await api.settings.submitFeedback({
        category,
        title: title.trim(),
        content: content.trim(),
        contact: contact.trim(),
        pageUrl: window.location.href,
        language: i18n.language,
      });
      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(data?.error || t('helpFeedback.messages.submitError'));
      }

      setStatus({ type: 'success', message: t('helpFeedback.messages.success') });
      setTitle('');
      setContent('');
      setCategory('suggestion');
    } catch (error) {
      console.error('Feedback submit error:', error);
      setStatus({ type: 'error', message: error.message || t('helpFeedback.messages.submitError') });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-3">
          <div className="rounded-lg border border-blue-200 bg-blue-50 p-2 text-blue-600 dark:border-blue-900/60 dark:bg-blue-950/40 dark:text-blue-300">
            <HelpCircle className="h-4 w-4" />
          </div>
          <div>
            <h3 className="text-lg font-semibold text-foreground">{t('helpFeedback.title')}</h3>
            <p className="text-sm text-muted-foreground">{t('helpFeedback.description')}</p>
          </div>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="rounded-lg border border-gray-200 bg-gray-50 p-4 dark:border-gray-800 dark:bg-gray-900/40 md:p-5">
        <div className="space-y-4">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div>
              <label htmlFor="settings-feedback-category" className="mb-1 block text-sm font-medium text-foreground">
                {t('helpFeedback.fields.category')}
              </label>
              <select
                id="settings-feedback-category"
                value={category}
                onChange={(event) => setCategory(event.target.value)}
                className="w-full rounded-lg border border-gray-300 bg-gray-50 px-3 py-2 text-sm text-gray-900 focus:border-blue-500 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
              >
                {categoryOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label htmlFor="settings-feedback-contact" className="mb-1 block text-sm font-medium text-foreground">
                {t('helpFeedback.fields.contact')}
              </label>
              <Input
                id="settings-feedback-contact"
                value={contact}
                onChange={(event) => setContact(event.target.value)}
                placeholder={t('helpFeedback.placeholders.contact')}
                maxLength={200}
              />
            </div>
          </div>

          <div>
            <label htmlFor="settings-feedback-title" className="mb-1 block text-sm font-medium text-foreground">
              {t('helpFeedback.fields.title')}
            </label>
            <Input
              id="settings-feedback-title"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder={t('helpFeedback.placeholders.title')}
              maxLength={MAX_TITLE_LENGTH}
            />
          </div>

          <div>
            <div className="mb-1 flex items-center justify-between gap-3">
              <label htmlFor="settings-feedback-content" className="block text-sm font-medium text-foreground">
                {t('helpFeedback.fields.content')}
              </label>
              <span className="text-xs text-muted-foreground">
                {t('helpFeedback.counter', { count: content.length, max: MAX_CONTENT_LENGTH })}
              </span>
            </div>
            <textarea
              id="settings-feedback-content"
              value={content}
              onChange={(event) => setContent(event.target.value)}
              placeholder={t('helpFeedback.placeholders.content')}
              maxLength={MAX_CONTENT_LENGTH}
              rows={7}
              className="w-full resize-none rounded-lg border border-gray-300 bg-gray-50 px-3 py-2 text-sm text-gray-900 focus:border-blue-500 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
              required
            />
          </div>

          {status && (
            <div
              className={`flex items-start gap-2 rounded-lg border px-3 py-2 text-sm ${
                status.type === 'success'
                  ? 'border-green-200 bg-green-50 text-green-700 dark:border-green-900/60 dark:bg-green-950/30 dark:text-green-300'
                  : 'border-red-200 bg-red-50 text-red-700 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-300'
              }`}
            >
              {status.type === 'success' ? (
                <CheckCircle2 className="mt-0.5 h-4 w-4 flex-shrink-0" />
              ) : (
                <AlertCircle className="mt-0.5 h-4 w-4 flex-shrink-0" />
              )}
              <span>{status.message}</span>
            </div>
          )}

          <div className="flex justify-end">
            <Button type="submit" disabled={isSubmitting} className="bg-blue-600 hover:bg-blue-700 disabled:opacity-50">
              {isSubmitting ? (
                <span className="flex items-center gap-2">
                  <span className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
                  {t('helpFeedback.actions.submitting')}
                </span>
              ) : (
                <span className="flex items-center gap-2">
                  <Send className="h-4 w-4" />
                  {t('helpFeedback.actions.submit')}
                </span>
              )}
            </Button>
          </div>
        </div>
      </form>
    </div>
  );
}
