# AutoMeta

AutoMeta 是一个面向医学研究与系统综述的本地优先 AI 工作台，用于组织和推进 Meta 分析的完整流程。它把文献检索、筛选、全文管理、数据提取、质量评价、统计分析、结果图表和论文撰写集中到同一个项目空间，并可连接 Claude、Codex 及兼容 OpenAI/Anthropic 协议的模型服务。

> Local-first AI workspace for systematic reviews and medical meta-analysis.

## 主要功能

- 按标准阶段创建和管理 Meta 分析项目
- PubMed 等文献来源的检索、去重与筛选
- PDF 获取、解析、阅读和证据追踪
- 结构化数据提取与质量检查
- R 统计分析、结果叙述和图表输出
- Methods、Results 等论文内容辅助撰写
- Claude、Codex、Gemini 及自定义 LLM Provider 接入
- 项目文件、任务、会话、Git 和研究技能统一管理
- Living review / surveillance 持续文献监测

## 环境要求

- Git
- Node.js `20`、`22` 或 `24`（推荐使用仓库 `.nvmrc` 指定的 Node.js 24）
- npm
- 可选：Claude Code、Codex CLI 或 Gemini CLI，按你要使用的 AI 后端安装
- 可选：R，用于运行部分 Meta 分析统计脚本

## 安装

### 1. 克隆仓库

```bash
git clone https://github.com/medicinehelp/Auto-meta-analysis.git
cd Auto-meta-analysis
```

### 2. 选择 Node.js 版本

如果已安装 `nvm`：

```bash
nvm install
nvm use
```

也可以直接使用受支持的 Node.js 20、22 或 24。

### 3. 安装依赖

```bash
npm install
```

需要严格按照 `package-lock.json` 安装时，可改用：

```bash
npm ci
```

### 4. 创建本地配置

macOS / Linux：

```bash
cp .env.example .env
```

Windows PowerShell：

```powershell
Copy-Item .env.example .env
```

编辑 `.env`，本地使用建议设置：

```dotenv
HOST=127.0.0.1
```

不要把 `.env`、API Key 或密码提交到 Git。

### 5. 启动开发环境

```bash
npm run dev
```

浏览器访问：<http://localhost:5173>

后端默认运行在：<http://localhost:3001>

首次进入后可直接使用，并在设置中配置需要的模型服务或 CLI。

## 生产模式运行

```bash
npm run build
npm run server
```

也可以使用一条命令完成构建并启动：

```bash
npm start
```

默认访问地址为 <http://localhost:3001>。

## 桌面版开发

```bash
npm run desktop:start
```

生成桌面安装包：

```bash
# macOS
npm run desktop:dist:mac

# Windows
npm run desktop:dist:win
```

## 数据与项目目录

AutoMeta 默认将应用数据库、会话索引和运行状态保存在：

```text
~/.autometa
```

项目目录可以由用户自行选择。未配置时的默认位置为：

- macOS / Linux：`~/autometa_workspace`
- Windows：优先 `D:\autometa_workspace`，其次 `E:\autometa_workspace`；如果 D、E 盘不可用，则使用当前用户目录下的 `autometa_workspace`

旧 MedHelp / MedAutoData 数据默认不会导入。如确实需要主动迁移旧数据，可在 `.env` 中设置：

```dotenv
AUTOMETA_IMPORT_LEGACY_DATA=true
```

建议迁移前备份旧数据库和项目目录。

## 常用命令

```bash
npm run dev         # 启动前后端开发环境
npm run build       # 构建前端
npm run typecheck   # TypeScript 类型检查
npm test            # 运行测试
npm run server      # 启动后端/生产服务
npm run preview     # 预览前端构建结果
```

## 常见问题

### 原生依赖安装失败

项目使用 `better-sqlite3`、`bcrypt`、`sharp` 等原生模块。请先确认 Node.js 版本受支持，然后重新安装：

```bash
rm -rf node_modules
npm install
```

Windows 用户如果遇到本地编译错误，可能还需要安装 Visual Studio Build Tools 的 C++ 构建组件和 Python。

### 页面能打开，但 AI 无法运行

请在应用设置中配置 LLM Provider，或确认所选 CLI 已安装并能在终端中执行，例如：

```bash
claude --version
codex --version
gemini --version
```

### 局域网或公网部署

请限制 CORS 来源，不要公开 API Key，并通过带 HTTPS 的反向代理部署。详细变量说明见 [配置文档](docs/configuration.zh-CN.md)。

## 更多文档

- [配置说明](docs/configuration.zh-CN.md)
- [Meta 分析自动化说明](docs/meta-analysis-automation.md)
- [流水线输出说明](docs/pipeline-outputs.md)
- [常见问题](docs/faq.zh-CN.md)

## 许可与引用

许可和上游归属信息请查看 [LICENSE](LICENSE) 与 [NOTICE](NOTICE)。如果本项目用于科研工作，请参考 [CITATION.cff](CITATION.cff) 进行引用。
