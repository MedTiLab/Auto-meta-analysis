import React, { useEffect, useRef, useState } from 'react';

import type { AttachedPrompt } from '../../types/types';
import {
  META_ANALYSIS_PIPELINE_SKILLS,
  META_ANALYSIS_STAGE_SKILLS,
  META_ANALYSIS_SYNTHESIS_TYPE_SKILLS,
} from '../../constants/metaAnalysisSkills';
import type { Project } from '../../../../types/app';

interface SkillDropdownProps {
  setInput: React.Dispatch<React.SetStateAction<string>>;
  textareaRef: React.RefObject<HTMLTextAreaElement>;
  setAttachedPrompt?: React.Dispatch<React.SetStateAction<AttachedPrompt | null>>;
  t: (key: string, options?: Record<string, unknown>) => string;
  selectedProject?: Project | null;
}

type SkillCategory = {
  key: string;
  icon: string;
  skills: string[];
  autoRoutePromptKey?: string;
  children?: SkillCategory[];
};

const META_SKILL_CATEGORIES: SkillCategory[] = [
  {
    key: 'metaPipeline',
    icon: '🚀',
    autoRoutePromptKey: 'skillShortcuts.routePrompts.metaPipeline',
    skills: [...META_ANALYSIS_PIPELINE_SKILLS],
  },
  {
    key: 'metaLiterature',
    icon: '📚',
    skills: [...META_ANALYSIS_STAGE_SKILLS.literature],
  },
  {
    key: 'metaIdeation',
    icon: '💡',
    skills: [...META_ANALYSIS_STAGE_SKILLS.ideation],
  },
  {
    key: 'metaScopingReview',
    icon: '🗺️',
    skills: [...META_ANALYSIS_STAGE_SKILLS.scopingReview],
  },
  {
    key: 'metaProtocol',
    icon: '📋',
    skills: [...META_ANALYSIS_STAGE_SKILLS.protocol],
  },
  {
    key: 'metaSearchDedupe',
    icon: '🔎',
    skills: [...META_ANALYSIS_STAGE_SKILLS.searchDedupe],
  },
  {
    key: 'metaTitleAbstractScreening',
    icon: '✅',
    autoRoutePromptKey: 'skillShortcuts.routePrompts.metaTitleAbstractScreening',
    skills: [...META_ANALYSIS_STAGE_SKILLS.titleAbstractScreening],
  },
  {
    key: 'metaFullTextDownload',
    icon: '📥',
    skills: [...META_ANALYSIS_STAGE_SKILLS.fullTextDownload],
  },
  {
    key: 'metaPdfAcquisition',
    icon: '⬇️',
    skills: [...META_ANALYSIS_STAGE_SKILLS.pdfAcquisition],
  },
  {
    key: 'metaMineru',
    icon: '📄',
    skills: [...META_ANALYSIS_STAGE_SKILLS.mineruParse],
  },
  {
    key: 'metaFullTextScreening',
    icon: '🧪',
    autoRoutePromptKey: 'skillShortcuts.routePrompts.metaFullTextScreening',
    skills: [...META_ANALYSIS_STAGE_SKILLS.fullTextScreening],
  },
  {
    key: 'metaExtractionQuality',
    icon: '🧾',
    skills: [...META_ANALYSIS_STAGE_SKILLS.extractionQuality],
  },
  {
    key: 'metaStatistics',
    icon: '📊',
    skills: [...META_ANALYSIS_STAGE_SKILLS.statistics],
    children: [
      {
        key: 'metaDiagnostic',
        icon: '🩺',
        skills: [...META_ANALYSIS_SYNTHESIS_TYPE_SKILLS.diagnostic],
      },
      {
        key: 'metaIntervention',
        icon: '💊',
        skills: [...META_ANALYSIS_SYNTHESIS_TYPE_SKILLS.intervention],
      },
      {
        key: 'metaPrognostic',
        icon: '⏱️',
        skills: [...META_ANALYSIS_SYNTHESIS_TYPE_SKILLS.prognostic],
      },
      {
        key: 'metaPrevalence',
        icon: '％',
        skills: [...META_ANALYSIS_SYNTHESIS_TYPE_SKILLS.prevalence],
      },
      {
        key: 'metaNetwork',
        icon: '🕸️',
        skills: [...META_ANALYSIS_SYNTHESIS_TYPE_SKILLS.network],
      },
    ],
  },
  {
    key: 'metaFigures',
    icon: '🎨',
    skills: [...META_ANALYSIS_STAGE_SKILLS.figures],
  },
  {
    key: 'metaManuscript',
    icon: '✍️',
    skills: [...META_ANALYSIS_STAGE_SKILLS.manuscript],
  },
  {
    key: 'metaPromotion',
    icon: '🎬',
    skills: [...META_ANALYSIS_STAGE_SKILLS.promotion],
  },
];

function buildCategoryPrompt(
  t: (key: string, options?: Record<string, unknown>) => string,
  category: SkillCategory,
) {
  const promptKey = `skillShortcuts.prompts.${category.key}`;
  const prompt = t(promptKey, { skills: category.skills.join(', ') });
  const resolved = prompt !== promptKey ? prompt : t('skillShortcuts.promptMulti', { skills: category.skills.join(', ') });
  return ensurePromptMentionsSkills(t, resolved, category.skills);
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

export default function SkillDropdown({
  setInput,
  textareaRef,
  setAttachedPrompt,
  t,
  selectedProject,
}: SkillDropdownProps) {
  const [open, setOpen] = useState(false);
  const [expandedCategory, setExpandedCategory] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const categories = META_SKILL_CATEGORIES;

  useEffect(() => {
    const handlePointerDown = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setOpen(false);
        setExpandedCategory(null);
      }
    };

    if (open) {
      document.addEventListener('mousedown', handlePointerDown);
    }

    return () => document.removeEventListener('mousedown', handlePointerDown);
  }, [open]);

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
      setInput((previous) => previous ? `${prompt}\n\n${previous}` : prompt);
      setTimeout(() => textareaRef.current?.focus(), 100);
    }

    setOpen(false);
    setExpandedCategory(null);
  };

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((previous) => !previous)}
        className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg border border-border/50 text-[11px] font-medium text-muted-foreground hover:text-foreground hover:bg-muted/40 transition-all duration-150"
      >
        <span>⚡</span>
        <span>{t('skillShortcuts.title')}</span>
        <svg className="w-3 h-3 text-muted-foreground/60 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {open && (
        <div className="absolute z-50 bottom-full mb-1 left-0 w-72 max-h-[360px] bg-popover border border-border rounded-xl shadow-xl overflow-y-auto">
          {categories.map((category) => {
            const isExpanded = expandedCategory === category.key;
            return (
              <div key={category.key}>
                <button
                  type="button"
                  onClick={() => setExpandedCategory(isExpanded ? null : category.key)}
                  className={`w-full flex items-center gap-2 px-3 py-2 text-left text-[11px] transition-colors ${
                    isExpanded ? 'bg-primary/8 text-foreground font-medium' : 'hover:bg-muted/50 text-muted-foreground'
                  }`}
                >
                  <span className="text-sm leading-none">{category.icon}</span>
                  <span className="flex-1">{t(`skillShortcuts.categories.${category.key}`)}</span>
                  <span className="text-[9px] text-muted-foreground/60">{category.skills.length}</span>
                </button>

                {isExpanded && (
                  <div className="px-3 pb-2">
                    <div className="flex flex-wrap gap-1">
                      {category.skills.map((skill) => (
                        <button
                          key={skill}
                          type="button"
                          onClick={() => inject(
                            t('skillShortcuts.promptSingle', { skill }),
                            category.icon,
                            t(`skillShortcuts.categories.${category.key}`),
                            category.key,
                          )}
                          className="px-2 py-0.5 text-[10px] font-medium rounded-full border border-border/50 bg-background hover:bg-muted hover:border-border transition-colors text-foreground"
                        >
                          {skill}
                        </button>
                      ))}
                    </div>

                    <button
                      type="button"
                      onClick={() => inject(
                        category.autoRoutePromptKey
                          ? ensurePromptMentionsSkills(
                              t,
                              t(category.autoRoutePromptKey, { skills: category.skills.join(', ') }),
                              category.skills,
                            )
                          : buildCategoryPrompt(t, category),
                        category.icon,
                        t(`skillShortcuts.categories.${category.key}`),
                        category.key,
                      )}
                      className="mt-1.5 text-[10px] font-medium text-primary hover:text-primary/80 transition-colors"
                    >
                      {category.autoRoutePromptKey ? t('skillShortcuts.useAutoRoute') : t('skillShortcuts.useAll')}
                    </button>

                    {category.children && category.children.length > 0 && (
                      <div className="mt-2 rounded-lg border border-border/45 bg-muted/20 p-2">
                        <p className="mb-1.5 text-[9px] font-semibold uppercase tracking-[0.16em] text-muted-foreground/70">
                          {t('skillShortcuts.metaStatisticTypes')}
                        </p>
                        <div className="flex flex-wrap gap-1">
                          {category.children.map((child) => (
                            <button
                              key={child.key}
                              type="button"
                              onClick={() => inject(
                                buildCategoryPrompt(t, child),
                                child.icon,
                                t(`skillShortcuts.categories.${child.key}`),
                                child.key,
                              )}
                              title={child.skills.join(', ')}
                              className="rounded-full border border-border/50 bg-background px-2 py-0.5 text-[10px] font-medium text-foreground transition-colors hover:border-primary/35 hover:bg-primary/5"
                            >
                              <span className="mr-1">{child.icon}</span>
                              {t(`skillShortcuts.categories.${child.key}`)}
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
