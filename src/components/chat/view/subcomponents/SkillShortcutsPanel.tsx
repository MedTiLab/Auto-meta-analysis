import React, { useState } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { AttachedPrompt } from '../../types/types';
import { META_ANALYSIS_SHORTCUT_SKILLS } from '../../constants/metaAnalysisSkills';

interface SkillShortcutsPanelProps {
  setInput: React.Dispatch<React.SetStateAction<string>>;
  textareaRef: React.RefObject<HTMLTextAreaElement>;
  setAttachedPrompt?: (prompt: AttachedPrompt | null) => void;
}

interface SkillCategory {
  key: string;
  icon: string;
  skills: string[];
  autoRoutePromptKey?: string;
}

const CATEGORIES: SkillCategory[] = [
  {
    key: 'metaAnalysis',
    icon: '📚',
    autoRoutePromptKey: 'skillShortcuts.routePrompts.metaAnalysis',
    skills: [...META_ANALYSIS_SHORTCUT_SKILLS],
  },
];

function buildCategoryPrompt(
  t: (key: string, options?: Record<string, unknown>) => string,
  category: SkillCategory,
  skills: string[],
) {
  const promptKey = `skillShortcuts.prompts.${category.key}`;
  const prompt = t(promptKey, { skills: skills.join(', ') });
  const resolved = prompt !== promptKey ? prompt : t('skillShortcuts.promptMulti', { skills: skills.join(', ') });
  return ensurePromptMentionsSkills(t, resolved, skills);
}

function ensurePromptMentionsSkills(
  t: (key: string, options?: Record<string, unknown>) => string,
  prompt: string,
  skills: string[],
) {
  if (!skills.length) return prompt;
  const lowerPrompt = prompt.toLowerCase();
  const hasAnySkill = skills.some((skill) => lowerPrompt.includes(skill.toLowerCase()));
  if (hasAnySkill) return prompt;
  const skillsLine = t('skillShortcuts.promptMulti', { skills: skills.join(', ') }).split('\n\n')[0];
  return `${prompt}\n\n${skillsLine}`;
}

export default function SkillShortcutsPanel({
  setInput,
  textareaRef,
  setAttachedPrompt,
}: SkillShortcutsPanelProps) {
  const { t } = useTranslation('chat');
  const [isCollapsed, setIsCollapsed] = useState(true);
  const [expandedCategory, setExpandedCategory] = useState<string | null>(null);
  const [selectedSkillsByCategory, setSelectedSkillsByCategory] = useState<Record<string, string[]>>({});

  const inject = (prompt: string, icon: string, title: string, categoryKey: string) => {
    if (setAttachedPrompt) {
      setAttachedPrompt({
        scenarioId: `skill-${categoryKey}`,
        scenarioIcon: icon,
        scenarioTitle: title,
        promptText: prompt,
      });
      setTimeout(() => textareaRef.current?.focus(), 100);
    } else {
      setInput(prev => prev ? `${prompt}\n\n${prev}` : prompt);
      setTimeout(() => {
        const el = textareaRef.current;
        if (!el) return;
        el.focus();
        const cursor = el.value.length;
        el.setSelectionRange(cursor, cursor);
      }, 100);
    }
  };

  const handleSingleSkillUse = (skill: string, category: SkillCategory) => {
    inject(
      t('skillShortcuts.promptSingle', { skill }),
      category.icon,
      t(`skillShortcuts.categories.${category.key}`),
      category.key,
    );
  };

  const toggleSkillSelection = (categoryKey: string, skill: string) => {
    setSelectedSkillsByCategory((prev) => {
      const current = prev[categoryKey] || [];
      const exists = current.includes(skill);
      const next = exists ? current.filter((item) => item !== skill) : [...current, skill];
      return { ...prev, [categoryKey]: next };
    });
  };

  const handleUseSelected = (category: SkillCategory) => {
    const selected = selectedSkillsByCategory[category.key] || [];
    if (selected.length === 0) {
      return;
    }
    inject(
      buildCategoryPrompt(t, category, selected),
      category.icon,
      t(`skillShortcuts.categories.${category.key}`),
      category.key,
    );
  };

  const clearSelected = (categoryKey: string) => {
    setSelectedSkillsByCategory((prev) => ({ ...prev, [categoryKey]: [] }));
  };

  const handleUseAll = (category: SkillCategory) => {
    const prompt = category.autoRoutePromptKey
      ? ensurePromptMentionsSkills(
          t,
          t(category.autoRoutePromptKey, { skills: category.skills.join(', ') }),
          category.skills,
        )
      : buildCategoryPrompt(t, category, category.skills);
    inject(
      prompt,
      category.icon,
      t(`skillShortcuts.categories.${category.key}`),
      category.key,
    );
  };

  return (
    <div className="relative w-full mt-2 mb-2">
      {!isCollapsed && <div className="absolute bottom-full left-0 right-0 z-20 mb-2 rounded-xl border border-border/60 bg-card/95 shadow-xl backdrop-blur">
        <div className="px-4 pt-4 pb-3">
        <div className="grid grid-cols-3 gap-2">
          {CATEGORIES.map((cat) => {
            const isExpanded = expandedCategory === cat.key;
            return (
              <button
                key={cat.key}
                onClick={() => setExpandedCategory(isExpanded ? null : cat.key)}
                className={`
                  flex items-center gap-1.5 px-2.5 py-2 rounded-xl border text-left transition-all duration-150
                  ${isExpanded
                    ? 'border-primary/50 bg-primary/5 ring-1 ring-primary/10'
                    : 'border-border/50 bg-card/60 hover:bg-card hover:border-border/80'
                  }
                `}
              >
                <span className="text-sm leading-none flex-shrink-0">{cat.icon}</span>
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-medium text-foreground leading-snug">
                    {t(`skillShortcuts.categories.${cat.key}`)}
                  </p>
                  <p className="text-[10px] text-muted-foreground leading-snug mt-0.5">
                    {cat.skills.length} skills
                  </p>
                </div>
                <ChevronDown className={`w-3 h-3 text-muted-foreground flex-shrink-0 transition-transform duration-150 ${isExpanded ? 'rotate-180' : ''}`} />
              </button>
            );
          })}
        </div>

        {expandedCategory && (() => {
          const cat = CATEGORIES.find((c) => c.key === expandedCategory);
          if (!cat) return null;
          const selectedSkills = selectedSkillsByCategory[cat.key] || [];
          const selectedCount = selectedSkills.length;
          return (
            <div className="mt-3 p-3 rounded-xl border border-border/40 bg-muted/30">
              <div className="flex items-center justify-between gap-2 mb-2.5">
                <span className="text-sm font-medium text-foreground">
                  {cat.icon} {t(`skillShortcuts.categories.${cat.key}`)}
                </span>
                <div className="flex items-center gap-1.5">
                  {selectedCount > 0 ? (
                    <button
                      onClick={() => clearSelected(cat.key)}
                      className="text-xs font-medium text-muted-foreground hover:text-foreground transition-colors px-2.5 py-1 rounded-lg hover:bg-muted"
                    >
                      {t('skillShortcuts.clearSelected')}
                    </button>
                  ) : null}
                  <button
                    onClick={() => handleUseSelected(cat)}
                    disabled={selectedCount === 0}
                    className={`
                      text-xs font-medium transition-colors px-2.5 py-1 rounded-lg
                      ${selectedCount === 0
                        ? 'text-muted-foreground/60 bg-muted/60 cursor-not-allowed'
                        : 'text-primary hover:text-primary/80 hover:bg-primary/5'
                      }
                    `}
                  >
                    {t('skillShortcuts.useSelected', { count: selectedCount })}
                  </button>
                  <button
                    onClick={() => handleUseAll(cat)}
                    className="text-xs font-medium text-primary hover:text-primary/80 transition-colors px-2.5 py-1 rounded-lg hover:bg-primary/5"
                  >
                    {cat.autoRoutePromptKey ? t('skillShortcuts.useAutoRoute') : t('skillShortcuts.useAll')}
                  </button>
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                {cat.skills.map((skill) => (
                  <div key={skill} className="flex items-center gap-1">
                    <button
                      onClick={() => toggleSkillSelection(cat.key, skill)}
                      className={`
                        px-3 py-1.5 text-xs font-medium rounded-full border transition-colors
                        ${selectedSkills.includes(skill)
                          ? 'border-primary/50 bg-primary/10 text-primary'
                          : 'border-border/50 bg-background hover:bg-muted hover:border-border text-foreground'
                        }
                      `}
                    >
                      {skill}
                    </button>
                    <button
                      onClick={() => handleSingleSkillUse(skill, cat)}
                      className="px-2 py-1.5 text-[11px] font-medium rounded-full border border-border/50 bg-background hover:bg-muted hover:border-border transition-colors text-muted-foreground"
                      title={t('skillShortcuts.useSingle')}
                    >
                      +
                    </button>
                  </div>
                ))}
              </div>
            </div>
          );
        })()}
        </div>
      </div>}

      <div className="rounded-xl border border-border/50 bg-card/60">
        <button
          onClick={() => setIsCollapsed((c) => !c)}
          className="w-full flex items-center justify-between px-4 py-3 cursor-pointer hover:bg-muted/30 transition-colors rounded-xl"
        >
          <h3 className="text-base font-semibold text-foreground">
            {t('skillShortcuts.title')}
          </h3>
          {isCollapsed ? (
            <ChevronUp className="w-4 h-4 text-muted-foreground" />
          ) : (
            <ChevronDown className="w-4 h-4 text-muted-foreground" />
          )}
        </button>
      </div>
    </div>
  );
}
