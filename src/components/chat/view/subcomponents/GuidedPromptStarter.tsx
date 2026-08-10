import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  META_PROJECT_GUIDED_PROMPT_SCENARIOS,
  type GuidedPromptScenario,
} from '../../constants/guidedPromptScenarios';
import { api } from '../../../../utils/api';
import { metaAnalysisApi } from '../../../meta-analysis/api/metaAnalysisApi';
import type { AttachedPrompt } from '../../types/types';
import type { Project } from '../../../../types/app';
import {
  META_PROJECT_FOLDER_SCHEMA_VERSION,
  META_PROJECT_TEMPLATE_ID,
  META_PROJECT_WORKFLOW,
} from '../../../../utils/projectKind';

interface GuidedPromptStarterProps {
  projectName: string;
  selectedProject?: Project | null;
  setInput: React.Dispatch<React.SetStateAction<string>>;
  textareaRef: React.RefObject<HTMLTextAreaElement>;
  setAttachedPrompt?: (prompt: AttachedPrompt | null) => void;
}

interface SkillTreeNode {
  name: string;
  type: 'directory' | 'file';
  children?: SkillTreeNode[];
}

function toCamelCase(value: string) {
  return value.replace(/-([a-z])/g, (_, char: string) => char.toUpperCase());
}

function uniqueSkills(skills: string[]) {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const skill of skills) {
    const normalized = skill.trim();
    const key = normalized.toLowerCase();
    if (!normalized || seen.has(key)) {
      continue;
    }
    seen.add(key);
    result.push(normalized);
  }
  return result;
}

function buildTemplate(
  t: (key: string, options?: Record<string, unknown>) => string,
  scenario: GuidedPromptScenario,
  skills: string[],
) {
  if (scenario.autoRoutePromptKey) {
    const routed = t(scenario.autoRoutePromptKey, {
      scenario: t(scenario.titleKey),
      skills: skills.join(', '),
    });
    return ensurePromptMentionsSkills(t, routed, skills);
  }

  const promptKey = `guidedStarter.prompts.${toCamelCase(scenario.id)}`;
  const prompt = t(promptKey, {
    scenario: t(scenario.titleKey),
    skills: skills.join(', '),
  });
  if (prompt !== promptKey) {
    return ensurePromptMentionsSkills(t, prompt, skills);
  }

  return ensurePromptMentionsSkills(t, [
    t('guidedStarter.template.intro', {
      scenario: t(scenario.titleKey),
      skills: skills.join(', '),
    }),
    '',
  ].join('\n'), skills);
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

export default function GuidedPromptStarter({
  projectName: _projectName,
  selectedProject,
  setInput,
  textareaRef,
  setAttachedPrompt,
}: GuidedPromptStarterProps) {
  const { t } = useTranslation('chat');
  const [selectedScenarioId, setSelectedScenarioId] = useState<string | null>(null);
  const [availableSkills, setAvailableSkills] = useState<Set<string> | null>(null);
  const [isSkillInventoryLoaded, setIsSkillInventoryLoaded] = useState(false);
  const [selectedSkillsByScenario, setSelectedSkillsByScenario] = useState<Record<string, string[]>>({});
  const scenarios = META_PROJECT_GUIDED_PROMPT_SCENARIOS;

  useEffect(() => {
    let cancelled = false;

    const normalize = (value: string) => value.trim().toLowerCase();
    const discovered = new Set<string>();

    const collect = (nodes: SkillTreeNode[]) => {
      for (const node of nodes) {
        if (node.type !== 'directory') {
          continue;
        }
        const hasSkillMd = (node.children || []).some(
          (child) => child.type === 'file' && child.name === 'SKILL.md',
        );
        if (hasSkillMd) {
          discovered.add(normalize(node.name));
        }
        if (Array.isArray(node.children) && node.children.length > 0) {
          collect(node.children);
        }
      }
    };

    const fetchSkills = async () => {
      try {
        const response = await api.getGlobalSkills();
        if (!response.ok) {
          if (!cancelled) {
            setIsSkillInventoryLoaded(true);
          }
          return;
        }
        const payload = (await response.json()) as SkillTreeNode[];
        collect(payload);
        if (!cancelled) {
          setAvailableSkills(discovered);
          setIsSkillInventoryLoaded(true);
        }
      } catch {
        // Keep static list as fallback.
        if (!cancelled) {
          setIsSkillInventoryLoaded(true);
        }
      }
    };

    fetchSkills();
    return () => {
      cancelled = true;
    };
  }, []);

  const persistMetaMode = (scenario: GuidedPromptScenario) => {
    if (!selectedProject?.name || !scenario.reviewType) {
      return;
    }

    void (async () => {
      try {
        await api.updateProjectMetadata(selectedProject.name, {
          projectKind: 'meta',
          metaAnalysis: {
            workflow: META_PROJECT_WORKFLOW,
            templateId: META_PROJECT_TEMPLATE_ID,
            reviewType: scenario.reviewType,
            folderSchemaVersion: META_PROJECT_FOLDER_SCHEMA_VERSION,
          },
        });
        const existing = await metaAnalysisApi.getProject(selectedProject.name);
        const project = existing.metaProject
          || (await metaAnalysisApi.initProject(selectedProject.name, {
            reviewType: scenario.reviewType,
            title: `${selectedProject.displayName || selectedProject.name} Meta project`,
            primaryOutcome: scenario.reviewType === 'diagnostic' ? 'diagnostic accuracy' : scenario.reviewType,
            folderSchemaVersion: META_PROJECT_FOLDER_SCHEMA_VERSION,
          })).metaProject;
        await metaAnalysisApi.updateProject(project.id, { reviewType: scenario.reviewType });
      } catch {
        // Prompt insertion should not be blocked by metadata sync.
      }
    })();
  };

  const injectTemplate = (scenario: GuidedPromptScenario, skills: string[]) => {
    persistMetaMode(scenario);
    const nextValue = buildTemplate(t, scenario, skills);
    if (setAttachedPrompt) {
      setAttachedPrompt({
        scenarioId: scenario.id,
        scenarioIcon: '',
        scenarioTitle: t(scenario.titleKey),
        promptText: nextValue,
      });
      setTimeout(() => {
        const el = textareaRef.current;
        if (!el) return;
        el.focus();
      }, 100);
    } else {
      setInput(prev => prev ? `${nextValue}\n\n${prev}` : nextValue);
      setTimeout(() => {
        const el = textareaRef.current;
        if (!el) return;
        el.focus();
        const cursor = el.value.length;
        el.setSelectionRange(cursor, cursor);
      }, 100);
    }
    setSelectedScenarioId(null);
  };

  const getScenarioSkills = (scenario: GuidedPromptScenario) => {
    const matchedSkills = availableSkills
      ? scenario.skills.filter((skill) => availableSkills.has(skill.toLowerCase()))
      : [];
    return uniqueSkills(matchedSkills.length > 0 ? matchedSkills : scenario.skills);
  };

  const toggleSkillSelection = (scenarioId: string, skill: string) => {
    setSelectedSkillsByScenario((prev) => {
      const current = prev[scenarioId] || [];
      const exists = current.includes(skill);
      const next = exists ? current.filter((item) => item !== skill) : [...current, skill];
      return { ...prev, [scenarioId]: next };
    });
  };

  const clearSelectedSkills = (scenarioId: string) => {
    setSelectedSkillsByScenario((prev) => ({ ...prev, [scenarioId]: [] }));
  };

  const handleScenarioSelect = (scenario: GuidedPromptScenario) => {
    setSelectedScenarioId((current) => current === scenario.id ? null : scenario.id);
  };

  const handleSingleSkillUse = (scenario: GuidedPromptScenario, skill: string) => {
    injectTemplate({ ...scenario, autoRoutePromptKey: undefined }, [skill]);
  };

  const handleUseSelectedSkills = (scenario: GuidedPromptScenario) => {
    const selectedSkills = selectedSkillsByScenario[scenario.id] || [];
    if (selectedSkills.length === 0) {
      return;
    }
    injectTemplate({ ...scenario, autoRoutePromptKey: undefined }, selectedSkills);
  };

  const handleUseAllSkills = (scenario: GuidedPromptScenario) => {
    injectTemplate(scenario, getScenarioSkills(scenario));
  };

  const handleUseChildScenario = (scenario: GuidedPromptScenario) => {
    injectTemplate(scenario, getScenarioSkills(scenario));
  };

  const activeScenario = selectedScenarioId
    ? scenarios.find((scenario) => scenario.id === selectedScenarioId) || null
    : null;
  const activeScenarioSkills = activeScenario ? getScenarioSkills(activeScenario) : [];
  const activeChildScenarios = activeScenario?.children || [];
  const activeSelectedSkills = activeScenario
    ? (selectedSkillsByScenario[activeScenario.id] || []).filter((skill) => activeScenarioSkills.includes(skill))
    : [];
  const activeSelectedCount = activeSelectedSkills.length;
  const isShowingFallbackSkills = Boolean(
    activeScenario
    && isSkillInventoryLoaded
    && availableSkills
    && activeScenario.skills.some((skill) => !availableSkills.has(skill.toLowerCase()))
    && activeScenarioSkills.length === activeScenario.skills.length,
  );

  return (
    <div className="relative z-30 mx-auto mt-3 w-full max-w-5xl px-4">
      <div className="flex flex-wrap justify-center gap-2 rounded-2xl border border-border/45 bg-muted/25 p-2 shadow-none backdrop-blur-sm dark:bg-white/[0.025]">
        {scenarios.map((scenario) => {
          const isActive = selectedScenarioId === scenario.id;
          return (
            <button
              key={scenario.id}
              type="button"
              onClick={() => handleScenarioSelect(scenario)}
              aria-pressed={isActive}
              className={`rounded-full border px-3.5 py-2 text-left shadow-sm transition-all duration-150 ${
                isActive
                  ? 'border-primary/65 bg-primary/90 text-primary-foreground ring-2 ring-primary/15'
                  : 'border-border/55 bg-background/45 text-foreground/75 hover:border-primary/35 hover:bg-primary/5 hover:text-foreground dark:border-white/8 dark:bg-white/[0.03] dark:text-white/70 dark:hover:bg-white/[0.07] dark:hover:text-white'
              }`}
            >
              <p className="flex items-center gap-1.5 whitespace-nowrap text-xs font-semibold">
                {t(scenario.titleKey)}
              </p>
            </button>
          );
        })}
      </div>

      {activeScenario && (
        <div className="absolute left-4 right-4 top-full z-50 mt-2 rounded-2xl border border-border/55 bg-card/90 px-4 py-4 shadow-xl shadow-black/10 backdrop-blur-md dark:bg-neutral-950/90">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
            <div className="min-w-0">
              <p className="text-sm font-semibold text-foreground">
                {t(activeScenario.titleKey)}
              </p>
              <p className="mt-1 text-xs leading-6 text-muted-foreground">
                {t(activeScenario.descriptionKey)}
              </p>
              {activeChildScenarios.length > 0 && (
                <div className="mt-3">
                  <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-muted-foreground/80">
                    {t('guidedStarter.metaStatisticTypes')}
                  </p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {activeChildScenarios.map((childScenario) => {
                      const childSkills = getScenarioSkills(childScenario);
                      return (
                        <button
                          key={childScenario.id}
                          type="button"
                          onClick={() => handleUseChildScenario(childScenario)}
                          className="rounded-full border border-border/55 bg-background/55 px-3 py-1.5 text-xs font-semibold text-foreground/80 shadow-sm transition-all duration-150 hover:border-primary/35 hover:bg-primary/5 hover:text-foreground"
                          title={childSkills.join(', ')}
                        >
                          {t(childScenario.titleKey)}
                          <span className="ml-1.5 text-[10px] font-medium text-muted-foreground">
                            {childSkills.length}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
              <p className="mt-3 text-[11px] font-medium uppercase tracking-[0.18em] text-muted-foreground/80">
                {t('guidedStarter.recommendedSkills')}
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {activeSelectedCount > 0 && (
                <button
                  type="button"
                  onClick={() => clearSelectedSkills(activeScenario.id)}
                  className="rounded-full border border-border/60 px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                >
                  {t('skillShortcuts.clearSelected')}
                </button>
              )}
              <button
                type="button"
                onClick={() => handleUseSelectedSkills(activeScenario)}
                disabled={activeSelectedCount === 0}
                className={`rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors ${
                  activeSelectedCount === 0
                    ? 'cursor-not-allowed border-border/40 bg-muted/40 text-muted-foreground/60'
                    : 'border-primary bg-primary text-primary-foreground shadow-sm hover:bg-primary/90'
                }`}
              >
                {t('skillShortcuts.useSelected', { count: activeSelectedCount })}
              </button>
              <button
                type="button"
                onClick={() => handleUseAllSkills(activeScenario)}
                className="rounded-full border border-primary/30 bg-primary/8 px-3 py-1.5 text-xs font-medium text-primary transition-colors hover:bg-primary/12"
              >
                {activeScenario.autoRoutePromptKey ? t('guidedStarter.useAutoRoute') : t('guidedStarter.useAllSkills')}
              </button>
            </div>
          </div>

          {isSkillInventoryLoaded && (
            <p className="mt-3 text-xs text-muted-foreground">
              {isShowingFallbackSkills
                ? t('guidedStarter.noAvailableSkillsFallback')
                : activeScenarioSkills.length === 0
                  ? t('guidedStarter.noAvailableSkills')
                  : ''}
            </p>
          )}

          {!isSkillInventoryLoaded && (
            <p className="mt-3 text-xs text-muted-foreground">
              {t('guidedStarter.loadingSkills')}
            </p>
          )}

          <div className="mt-3 max-h-44 overflow-y-auto rounded-xl border border-border/45 bg-muted/25 p-2 sm:max-h-56">
            <div className="flex flex-wrap gap-2">
              {activeScenarioSkills.map((skill, index) => {
                const isSelected = activeSelectedSkills.includes(skill);
                return (
                  <div key={`${skill}-${index}`} className="flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => toggleSkillSelection(activeScenario.id, skill)}
                      aria-pressed={isSelected}
                      className={`rounded-full border px-3 py-1.5 text-xs font-semibold shadow-sm transition-all duration-150 ${
                        isSelected
                          ? 'border-primary bg-primary/90 text-primary-foreground ring-2 ring-primary/15'
                          : 'border-border/55 bg-background/55 text-foreground/80 hover:border-primary/35 hover:bg-primary/5 hover:text-foreground'
                      }`}
                    >
                      {skill}
                    </button>
                    <button
                      type="button"
                      onClick={() => handleSingleSkillUse(activeScenario, skill)}
                      className="rounded-full border border-border/50 bg-background px-2 py-1.5 text-[11px] font-medium text-muted-foreground transition-colors hover:bg-muted hover:border-border hover:text-foreground"
                      title={t('skillShortcuts.useSingle')}
                    >
                      +
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
