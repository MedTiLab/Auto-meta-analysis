import { useCallback, useMemo, useState } from 'react';
import { useDropzone } from 'react-dropzone';
import { UploadCloud, X, FileArchive, Check, AlertCircle, Plus } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { api } from '../utils/api';

type LocalizedLabel = {
  zh: string;
  en: string;
};

type ValidationResult = {
  valid: boolean;
  skillName?: string;
  frontmatter?: Record<string, unknown>;
  description?: string;
  fileCount?: number;
  hasPrompts?: boolean;
  hasReferences?: boolean;
  error?: string;
};

type SkillUploadModalProps = {
  projectName?: string;
  existingTags?: { label: string; count: number }[];
  onClose: () => void;
  onUploadComplete: () => void | Promise<void>;
};

type LocaleKey = 'zh' | 'en';

const UI_TEXT: Record<LocaleKey, Record<string, string>> = {
  zh: {
    title: '上传技能包',
    drop: '拖拽 .zip 文件到这里，或点击选择文件',
    maxHint: '最大 50MB，压缩包需包含 SKILL.md',
    validating: '正在校验...',
    validationFailed: '校验失败。',
    uploadFailed: '上传失败。',
    duplicate: '已存在同名技能。',
    files: '{{count}} 个文件',
    hasPrompts: '包含 prompts/',
    hasReferences: '包含 references/',
    stage: '阶段',
    category: '类别',
    domain: '领域',
    origin: '来源',
    downloaded: '下载整理',
    humanWritten: '人工编写',
    customTags: '自定义标签',
    addTag: '添加标签...',
    add: '添加',
    cancel: '取消',
    uploading: '上传中...',
    upload: '上传技能',
    close: '关闭',
  },
  en: {
    title: 'Upload Skill',
    drop: 'Drag and drop a .zip file here, or click to browse',
    maxHint: 'Max 50MB. Must contain SKILL.md',
    validating: 'Validating...',
    validationFailed: 'Validation failed.',
    uploadFailed: 'Upload failed.',
    duplicate: 'A skill with that name already exists.',
    files: '{{count}} files',
    hasPrompts: 'has prompts/',
    hasReferences: 'has references/',
    stage: 'Stage',
    category: 'Category',
    domain: 'Domain',
    origin: 'Origin',
    downloaded: 'Downloaded',
    humanWritten: 'Human Written',
    customTags: 'Custom Tags',
    addTag: 'Add a tag...',
    add: 'Add',
    cancel: 'Cancel',
    uploading: 'Uploading...',
    upload: 'Upload Skill',
    close: 'Close',
  },
};

function resolveLocaleKey(language: string): LocaleKey {
  return language.toLowerCase().startsWith('zh') ? 'zh' : 'en';
}

const STAGE_OPTIONS: { label: string; value: LocalizedLabel }[] = [
  { label: 'Orchestration', value: { zh: '阶段: 编排', en: 'Stage: Orchestration' } },
  { label: 'Resource Prep', value: { zh: '阶段: 资源准备', en: 'Stage: Resource Prep' } },
  { label: 'Idea Generation', value: { zh: '阶段: Idea生成', en: 'Stage: Idea Generation' } },
  { label: 'Idea Evaluation', value: { zh: '阶段: Idea评估', en: 'Stage: Idea Evaluation' } },
  { label: 'Literature', value: { zh: '阶段: 文献', en: 'Stage: Literature' } },
  { label: 'Experiment Dev', value: { zh: '阶段: 实验开发', en: 'Stage: Experiment Dev' } },
  { label: 'Analysis', value: { zh: '阶段: 实验分析', en: 'Stage: Analysis' } },
  { label: 'Paper Writing', value: { zh: '阶段: 论文撰写', en: 'Stage: Paper Writing' } },
  { label: 'Paper Review', value: { zh: '阶段: 论文评审', en: 'Stage: Paper Review' } },
  { label: 'Publication Sync', value: { zh: '阶段: 发布同步', en: 'Stage: Publication Sync' } },
];

const CATEGORY_OPTIONS: { label: string; value: LocalizedLabel }[] = [
  { label: 'Training & Tuning', value: { zh: '类别: 训练与调优', en: 'Category: Training & Tuning' } },
  { label: 'Inference & Optimization', value: { zh: '类别: 推理与优化', en: 'Category: Inference & Optimization' } },
  { label: 'Data & Applications', value: { zh: '类别: 数据与应用', en: 'Category: Data & Applications' } },
  { label: 'Model & Research', value: { zh: '类别: 模型与研究', en: 'Category: Model & Research' } },
  { label: 'Evaluation & Safety', value: { zh: '类别: 评估与安全', en: 'Category: Evaluation & Safety' } },
  { label: 'Infra & Ops', value: { zh: '类别: 基础设施与运维', en: 'Category: Infra & Ops' } },
];

const DOMAIN_OPTIONS: { label: string; value: LocalizedLabel }[] = [
  { label: 'Medical', value: { zh: '领域: 医疗', en: 'Domain: Medical' } },
  { label: 'Data', value: { zh: '领域: 数据', en: 'Domain: Data' } },
  { label: 'Agent', value: { zh: '领域: Agent', en: 'Domain: Agent' } },
  { label: 'Vision', value: { zh: '领域: 视觉', en: 'Domain: Vision' } },
  { label: 'General', value: { zh: '领域: 通用', en: 'Domain: General' } },
];

function chipClass(selected: boolean, color: 'cyan' | 'emerald' | 'violet' | 'blue' | 'slate'): string {
  const colorMap = {
    cyan: selected
      ? 'border-cyan-500 bg-cyan-50 text-cyan-700 dark:bg-cyan-950/50 dark:text-cyan-200'
      : 'border-border bg-background text-muted-foreground hover:bg-muted',
    emerald: selected
      ? 'border-emerald-500 bg-emerald-50 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-200'
      : 'border-border bg-background text-muted-foreground hover:bg-muted',
    violet: selected
      ? 'border-violet-500 bg-violet-50 text-violet-700 dark:bg-violet-950/50 dark:text-violet-200'
      : 'border-border bg-background text-muted-foreground hover:bg-muted',
    blue: selected
      ? 'border-blue-500 bg-blue-50 text-blue-700 dark:bg-blue-950/50 dark:text-blue-200'
      : 'border-border bg-background text-muted-foreground hover:bg-muted',
    slate: selected
      ? 'border-sky-500 bg-sky-50 text-sky-700 dark:bg-sky-950/50 dark:text-sky-200'
      : 'border-border bg-background text-muted-foreground hover:bg-muted',
  };
  return `rounded-full border px-2.5 py-1 text-xs transition cursor-pointer ${colorMap[color]}`;
}

export default function SkillUploadModal({ projectName, onClose, onUploadComplete }: SkillUploadModalProps) {
  const { i18n } = useTranslation();
  const localeKey = useMemo(() => resolveLocaleKey(i18n.language || 'en'), [i18n.language]);
  const text = UI_TEXT[localeKey];
  const [file, setFile] = useState<File | null>(null);
  const [validating, setValidating] = useState(false);
  const [validation, setValidation] = useState<ValidationResult | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);

  // Tag state
  const [selectedStage, setSelectedStage] = useState<number | null>(null);
  const [selectedCategory, setSelectedCategory] = useState<number | null>(null);
  const [selectedDomain, setSelectedDomain] = useState<number | null>(null);
  const [origin, setOrigin] = useState<'downloaded' | 'human-written'>('downloaded');
  const [customTags, setCustomTags] = useState<string[]>([]);
  const [customTagInput, setCustomTagInput] = useState('');

  const handleValidate = useCallback(async (zipFile: File) => {
    setValidating(true);
    setValidation(null);
    setUploadError(null);

    try {
      const formData = new FormData();
      formData.append('file', zipFile);
      const resp = projectName
        ? await api.validateSkillZip(projectName, formData)
        : await api.validateGlobalSkillZip(formData);
      const data = await resp.json();

      if (resp.ok && data.valid) {
        setValidation(data);
      } else {
        setValidation({ valid: false, error: data.error || text.validationFailed });
      }
    } catch (err) {
      setValidation({ valid: false, error: err instanceof Error ? err.message : text.validationFailed });
    } finally {
      setValidating(false);
    }
  }, [projectName, text.validationFailed]);

  const onDrop = useCallback((accepted: File[]) => {
    const zipFile = accepted[0];
    if (!zipFile) return;
    setFile(zipFile);
    setValidation(null);
    setUploadError(null);
    setSelectedStage(null);
    setSelectedCategory(null);
    setSelectedDomain(null);
    setOrigin('downloaded');
    setCustomTags([]);
    handleValidate(zipFile);
  }, [handleValidate]);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: { 'application/zip': ['.zip'] },
    maxSize: 50 * 1024 * 1024,
    multiple: false,
  });

  const handleUpload = useCallback(async () => {
    if (!file || !validation?.valid) return;
    setUploading(true);
    setUploadError(null);

    try {
      const formData = new FormData();
      formData.append('file', file);

      const tags: Record<string, unknown> = { origin };
      if (selectedStage !== null) {
        tags.stageOverride = STAGE_OPTIONS[selectedStage].value;
      }
      if (selectedCategory !== null) {
        tags.categoryOverride = CATEGORY_OPTIONS[selectedCategory].value;
      }
      if (selectedDomain !== null) {
        tags.domainOverride = DOMAIN_OPTIONS[selectedDomain].value;
      }
      if (customTags.length > 0) {
        tags.customTags = customTags;
      }
      formData.append('tags', JSON.stringify(tags));

      const resp = projectName
        ? await api.uploadSkill(projectName, formData)
        : await api.uploadGlobalSkill(formData);
      const data = await resp.json();

      if (resp.ok && data.success) {
        await onUploadComplete();
        onClose();
      } else if (resp.status === 409) {
        setUploadError(data.error || text.duplicate);
      } else {
        setUploadError(data.error || text.uploadFailed);
      }
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : text.uploadFailed);
    } finally {
      setUploading(false);
    }
  }, [file, validation, projectName, origin, selectedStage, selectedCategory, selectedDomain, customTags, onUploadComplete, onClose, text.duplicate, text.uploadFailed]);

  const addCustomTag = useCallback(() => {
    const tag = customTagInput.trim();
    if (tag && !customTags.includes(tag)) {
      setCustomTags((prev) => [...prev, tag]);
    }
    setCustomTagInput('');
  }, [customTagInput, customTags]);

  const removeCustomTag = useCallback((tag: string) => {
    setCustomTags((prev) => prev.filter((t) => t !== tag));
  }, []);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="w-full max-w-xl rounded-2xl border border-border bg-card p-5 shadow-2xl max-h-[90vh] overflow-auto"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-lg font-semibold text-foreground">{text.title}</h3>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-border p-1.5 text-muted-foreground hover:bg-muted"
            aria-label={text.close}
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Dropzone */}
        <div
          {...getRootProps()}
          className={`mb-4 flex flex-col items-center justify-center rounded-xl border-2 border-dashed p-8 transition cursor-pointer ${
            isDragActive
              ? 'border-sky-400 bg-sky-50/50 dark:bg-sky-950/30'
              : 'border-border bg-muted/30 hover:border-sky-300 hover:bg-sky-50/30 dark:hover:bg-sky-950/20'
          }`}
        >
          <input {...getInputProps()} />
          <UploadCloud className="h-8 w-8 text-muted-foreground mb-2" />
          {file ? (
            <div className="flex items-center gap-2 text-sm text-foreground">
              <FileArchive className="h-4 w-4" />
              <span className="font-medium">{file.name}</span>
              <span className="text-muted-foreground">({(file.size / 1024).toFixed(0)} KB)</span>
            </div>
          ) : (
            <>
              <p className="text-sm text-foreground font-medium">
                {text.drop}
              </p>
              <p className="text-xs text-muted-foreground mt-1">{text.maxHint}</p>
            </>
          )}
        </div>

        {/* Validating spinner */}
        {validating && (
          <div className="mb-4 flex items-center gap-2 text-sm text-muted-foreground">
            <div className="h-4 w-4 animate-spin rounded-full border-2 border-sky-400 border-t-transparent" />
            {text.validating}
          </div>
        )}

        {/* Validation error */}
        {validation && !validation.valid && (
          <div className="mb-4 rounded-md border border-red-300/60 bg-red-50 dark:bg-red-900/20 px-3 py-2 text-sm text-red-700 dark:text-red-300 flex items-start gap-2">
            <AlertCircle className="h-4 w-4 mt-0.5 flex-shrink-0" />
            <span>{validation.error}</span>
          </div>
        )}

        {/* Validation success - show skill info and tag selectors */}
        {validation?.valid && (
          <div className="space-y-4">
            {/* Skill info */}
            <div className="rounded-lg border border-border bg-muted/30 p-3">
              <div className="flex items-center gap-2 mb-1">
                <Check className="h-4 w-4 text-green-500" />
                <span className="text-sm font-semibold text-foreground">{validation.skillName}</span>
              </div>
              {validation.description && (
                <p className="text-xs text-muted-foreground ml-6 mb-1">{validation.description}</p>
              )}
              <div className="flex flex-wrap gap-2 ml-6 text-xs text-muted-foreground">
                <span>{text.files.replace('{{count}}', String(validation.fileCount ?? 0))}</span>
                {validation.hasPrompts && <span>{text.hasPrompts}</span>}
                {validation.hasReferences && <span>{text.hasReferences}</span>}
              </div>
            </div>

            {/* Stage selector */}
            <div>
              <label className="text-xs font-medium text-foreground mb-1.5 block">{text.stage}</label>
              <div className="flex flex-wrap gap-1.5">
                {STAGE_OPTIONS.map((opt, idx) => (
                  <button
                    key={opt.label}
                    type="button"
                    onClick={() => setSelectedStage(selectedStage === idx ? null : idx)}
                    className={chipClass(selectedStage === idx, 'cyan')}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Category selector */}
            <div>
              <label className="text-xs font-medium text-foreground mb-1.5 block">{text.category}</label>
              <div className="flex flex-wrap gap-1.5">
                {CATEGORY_OPTIONS.map((opt, idx) => (
                  <button
                    key={opt.label}
                    type="button"
                    onClick={() => setSelectedCategory(selectedCategory === idx ? null : idx)}
                    className={chipClass(selectedCategory === idx, 'violet')}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Domain selector */}
            <div>
              <label className="text-xs font-medium text-foreground mb-1.5 block">{text.domain}</label>
              <div className="flex flex-wrap gap-1.5">
                {DOMAIN_OPTIONS.map((opt, idx) => (
                  <button
                    key={opt.label}
                    type="button"
                    onClick={() => setSelectedDomain(selectedDomain === idx ? null : idx)}
                    className={chipClass(selectedDomain === idx, 'emerald')}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Origin selector */}
            <div>
              <label className="text-xs font-medium text-foreground mb-1.5 block">{text.origin}</label>
              <div className="flex gap-4 text-sm">
                <label className="flex items-center gap-1.5 cursor-pointer">
                  <input
                    type="radio"
                    name="origin"
                    checked={origin === 'downloaded'}
                    onChange={() => setOrigin('downloaded')}
                    className="accent-sky-500"
                  />
                  <span className="text-foreground">{text.downloaded}</span>
                </label>
                <label className="flex items-center gap-1.5 cursor-pointer">
                  <input
                    type="radio"
                    name="origin"
                    checked={origin === 'human-written'}
                    onChange={() => setOrigin('human-written')}
                    className="accent-sky-500"
                  />
                  <span className="text-foreground">{text.humanWritten}</span>
                </label>
              </div>
            </div>

            {/* Custom tags */}
            <div>
              <label className="text-xs font-medium text-foreground mb-1.5 block">{text.customTags}</label>
              <div className="flex flex-wrap gap-1.5 mb-2">
                {customTags.map((tag) => (
                  <span
                    key={tag}
                    className="inline-flex items-center gap-1 rounded-full border border-sky-300 bg-sky-50 px-2 py-0.5 text-xs text-sky-700 dark:border-sky-600 dark:bg-sky-950/40 dark:text-sky-200"
                  >
                    {tag}
                    <button
                      type="button"
                      onClick={() => removeCustomTag(tag)}
                      className="hover:text-red-500"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </span>
                ))}
              </div>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={customTagInput}
                  onChange={(e) => setCustomTagInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      addCustomTag();
                    }
                  }}
                  placeholder={text.addTag}
                  className="flex-1 rounded-lg border border-border bg-background px-3 py-1.5 text-sm text-foreground outline-none focus:ring-2 focus:ring-sky-300/70 dark:focus:ring-sky-700/70"
                />
                <button
                  type="button"
                  onClick={addCustomTag}
                  disabled={!customTagInput.trim()}
                  className="inline-flex items-center gap-1 rounded-md border border-border bg-background/80 px-2.5 py-1.5 text-sm text-foreground hover:bg-muted transition-colors disabled:opacity-40"
                >
                  <Plus className="h-3.5 w-3.5" />
                  {text.add}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Upload error */}
        {uploadError && (
          <div className="mt-4 rounded-md border border-red-300/60 bg-red-50 dark:bg-red-900/20 px-3 py-2 text-sm text-red-700 dark:text-red-300 flex items-start gap-2">
            <AlertCircle className="h-4 w-4 mt-0.5 flex-shrink-0" />
            <span>{uploadError}</span>
          </div>
        )}

        {/* Actions */}
        <div className="mt-5 flex justify-end gap-3">
          <button
            type="button"
            onClick={onClose}
            className="inline-flex items-center gap-2 px-3 py-1.5 rounded-md border border-border bg-background/80 text-sm text-foreground hover:bg-muted transition-colors"
          >
            {text.cancel}
          </button>
          <button
            type="button"
            onClick={handleUpload}
            disabled={!validation?.valid || uploading}
            className="inline-flex items-center gap-2 px-4 py-1.5 rounded-md border border-sky-500 bg-sky-500 text-sm text-white hover:bg-sky-600 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {uploading ? (
              <>
                <div className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white border-t-transparent" />
                {text.uploading}
              </>
            ) : (
              <>
                <UploadCloud className="h-3.5 w-3.5" />
                {text.upload}
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
