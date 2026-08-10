export const LOGIN_PAGE_CONTENT = {
  'zh-CN': {
    brand: 'MedHelp®',
    eyebrow: 'Meta 分析工作台',
    title: '从研究问题到可复现综述产物的一站式工作台',
    description:
      'MedHelp® 将智能体对话、文献动态、参考文献、任务流水线和文件管理整合到同一个入口，帮助团队持续推进系统综述与 Meta 分析。',
    highlights: [
      '围绕综述问题组织分析会话、资料和任务',
      '沉淀文献证据、Zotero 参考文献和研究产物',
      '衔接本地工作区、Git 和多智能体流程',
    ],
    metrics: [
      { value: '10', label: '阶段 Meta 流程' },
      { value: '1', label: '统一工作区入口' },
      { value: 'AI', label: '辅助证据分析' },
    ],
    form: {
      eyebrow: '账号访问',
      loginDescription: '登录后继续访问你的研究工作区、分析会话和自动化任务。',
      registerDescription: '创建账户后即可配置通知邮箱，并开始管理你的研究工作区。',
      securityNote: '账户用于隔离本机服务中的研究工作区和个人配置。',
    },
  },
  en: {
    brand: 'MedHelp®',
    eyebrow: 'Meta Analysis Workspace',
    title: 'One workspace from review question to reproducible output',
    description:
      'MedHelp® brings agent chat, literature dynamics, references, task pipelines, and files into one focused entry point for systematic reviews and Meta analysis.',
    highlights: [
      'Organize review sessions, materials, and tasks around each evidence question',
      'Capture literature evidence, Zotero references, and research outputs',
      'Connect local workspaces, Git, and multi-agent workflows',
    ],
    metrics: [
      { value: '10', label: 'stage Meta workflow' },
      { value: '1', label: 'unified workspace entry' },
      { value: 'AI', label: 'evidence assistance' },
    ],
    form: {
      eyebrow: 'Account Access',
      loginDescription: 'Sign in to continue your workspaces, analysis sessions, and automation tasks.',
      registerDescription: 'Create an account to configure notifications and start managing research workspaces.',
      securityNote: 'Accounts separate research workspaces and personal settings inside this local service.',
    },
  },
};

export function getLoginPageContent(language = 'zh-CN') {
  const normalized = language.toLowerCase();
  return normalized.startsWith('zh') ? LOGIN_PAGE_CONTENT['zh-CN'] : LOGIN_PAGE_CONTENT.en;
}
