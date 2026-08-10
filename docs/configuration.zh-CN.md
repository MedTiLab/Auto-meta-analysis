[English](./configuration.md) | [中文](./configuration.zh-CN.md)

# 配置参考

AutoMeta 通过项目根目录下的 `.env` 文件中的环境变量进行配置。本指南记录主要的运行变量。

## `.env` 加载机制

1. **后端** — `server/load-env.js` 在启动时逐行读取 `.env`，对 `process.env` 中尚不存在的键进行设置。系统环境变量始终优先。
   在 macOS / Linux 上，后端还会在启动时额外从登录 shell 中导入一次 `PATH`、`PYENV_*`、`CONDA_*`、`VIRTUAL_ENV`、`HOMEBREW_*` 等与命令解析相关的环境变量，这样即使应用是通过图形界面启动，也能更稳定地找到 shell 配置里的工具。
2. **前端** — Vite 自动加载 `.env`。只有以 `VITE_` 为前缀的变量会暴露给浏览器端代码。
3. **优先级** — 系统环境变量 > `.env` 文件值。

> **快速开始：** `cp .env.example .env` 即可获得合理的默认值。请参阅[快速入门指南](./quickstart.zh-CN.md)了解分步操作。

---

## 配置参考

### 服务器

| 变量 | 是否必需 | 默认值 | 说明 |
|------|---------|--------|------|
| `HOST` | 否 | `127.0.0.1` | 服务器监听地址。仅在可信反向代理之后才设置为 `0.0.0.0`。 |
| `PORT` | 否 | `3001` | Express API + WebSocket 服务器端口。 |
| `VITE_PORT` | 否 | `5173` | Vite 开发服务器端口（仅开发模式）。 |
| `CORS_ORIGINS` / `CORS_ORIGIN` | 否 | 仅允许本机来源 | 允许跨域访问 API 的浏览器来源，多个值用英文逗号分隔。 |
| `CLAUDE_CLI_PATH` | 否 | `claude` | Claude Code 二进制文件的绝对或相对路径。如果 `claude` 不在你的 `PATH` 中，可在此处覆盖。 |
| `CURSOR_CLI_PATH` | 否 | 自动探测（先 `cursor-agent`，再 `cursor agent`，最后 `agent`） | 覆盖 Cursor CLI 命令/二进制名。适用于你的环境只提供某一个别名的情况。 |
| `GEMINI_CLI_PATH` | 否 | `gemini` | 覆盖 Gemini CLI 命令/二进制名。适用于通过自定义别名或路径安装 Gemini 的环境。 |
| `CODEX_CLI_PATH` | 否 | `codex` | 覆盖 Codex CLI 命令/二进制名。适用于 Codex 不在默认 `PATH` 中的环境。 |
| `MEDAUTODATA_LOGIN_SHELL` | 否 | 自动探测（优先 `$SHELL`，再读账户登录 shell，最后使用平台默认值） | 覆盖后端启动时用于导入登录 shell 环境的 shell。若你的 Python 或包管理器只在某个特定 shell 配置中初始化，可用它指定。 |
| `MEDAUTODATA_DISABLE_LOGIN_SHELL_ENV_IMPORT` | 否 | `0` | 设为 `1` 可关闭启动时从登录 shell 导入 `PATH` 和 Python / 包管理器相关环境变量。 |

### 数据库

| 变量 | 是否必需 | 默认值 | 说明 |
|------|---------|--------|------|
| `DATABASE_PATH` | 否 | `~/.autometa/auth.db` | SQLite 数据库文件的绝对路径。如果目录不存在会自动创建。 |

### 访问保护

| 变量 | 是否必需 | 默认值 | 说明 |
|------|---------|--------|------|
| `API_KEY` | 否 | *（无）* | 非本机部署可设置此项，为 API 增加一层访问保护。 |

### 上下文窗口

| 变量 | 是否必需 | 默认值 | 说明 |
|------|---------|--------|------|
| `CONTEXT_WINDOW` | 否 | `160000` | 发送给后端 CLI 进程的最大令牌上下文窗口大小。 |
| `VITE_CONTEXT_WINDOW` | 否 | `160000` | 暴露给前端的相同值（必须与 `CONTEXT_WINDOW` 一致）。 |

### 平台模式

平台模式是一个高级部署选项。大多数用户应保持这些配置为注释状态。

| 变量 | 是否必需 | 默认值 | 说明 |
|------|---------|--------|------|
| `VITE_IS_PLATFORM` | 否 | `false` | 设为 `true` 以启用平台部署相关行为。 |
| `WORKSPACES_ROOT` | 否 | 平台相关的 `autometa_workspace` | AutoMeta 查找和创建项目工作区的默认根目录。用户仍可在应用中自定义。 |
| `MEDAUTODATA_LOCK_PROJECT_PATHS` | 否 | `false` | 设为 `true` 后，新项目会统一创建到 `WORKSPACES_ROOT`，不会再追加用户名或 user-id 子目录。 |

### 集成

| 变量 | 是否必需 | 默认值 | 说明 |
|------|---------|--------|------|
| `GEMINI_API_KEY` | 否 | *（无）* | 用于图像生成和其他直连 Gemini 请求的 API 密钥。 |
| `GEMINI_API_BASE_URL` | 否 | `https://generativelanguage.googleapis.com` | 覆盖 Gemini API 的基础地址。接入 Gemini 兼容的第三方网关时使用，例如 `https://api.go-model.com`。这里填写网关根地址即可，不要填写完整的 `models/...` 路径。 |
| `GOOGLE_API_KEY` | 否 | *（无）* | `GEMINI_API_KEY` 的兼容别名，保留给旧脚本和 Gemini CLI 习惯用法。 |
| `OPENAI_API_KEY` | 否 | *（无）* | OpenAI API 密钥，用于 Codex 集成。仅在使用 Codex CLI 后端时需要。 |

### 高级

| 变量 | 是否必需 | 默认值 | 说明 |
|------|---------|--------|------|
| `CLAUDE_TOOL_APPROVAL_TIMEOUT_MS` | 否 | `55000` | Claude 工具审批提示的超时时间（毫秒），超时后自动拒绝。 |
| `MEDAUTODATA_ENABLE_SYSTEM_UPDATE` | 否 | `false` | 启用会在服务器上执行包更新命令的认证接口 `/api/system/update`。托管部署应保持关闭。 |

### LLM 服务商

需要认证的 `/api/providers` 后端负责管理 Claude 兼容和 OpenAI 兼容服务商。完整预设包括 Claude Official、DeepSeek、智谱 GLM、Kimi、MiniMax、接口AI、胜算云、TeamoRouter、LM Studio、Ollama 与自定义端点，并提供内置的 ChatGPT Official 和 Grok Official OAuth。OpenAI Chat Completions、OpenAI Responses 与 Azure OpenAI Responses 请求会经过仅限本机回环访问的 Anthropic Messages 协议桥，工具调用、图片、推理块、用量和 SSE 流式响应都会转换。Amazon Bedrock、Google Vertex AI 和 Microsoft Foundry 仍可通过 Agent SDK 原生云路由使用，可在服务商托管设置或进程环境变量中配置 `CLAUDE_CODE_USE_BEDROCK`、`CLAUDE_CODE_USE_VERTEX` 和 `CLAUDE_CODE_USE_FOUNDRY`。

| 变量 | 是否必需 | 默认值 | 说明 |
|------|---------|--------|------|
| `MEDAUTODATA_PROVIDER_DIR` | 否 | `<应用数据目录>/llm` | 覆盖 `providers.json` 和官方服务商 OAuth 文件的保存目录。文件采用原子写入并设置为仅当前用户可读写。 |
| `LLM_PROVIDER_TEST_TIMEOUT_MS` | 否 | `30000` | 服务商连通性测试超时。 |
| `LLM_PROVIDER_REQUEST_TIMEOUT_MS` | 否 | `300000` | 上游服务商请求超时。 |
| `MEDAUTODATA_ALLOW_REMOTE_PROVIDER_PROXY` | 否 | `false` | 允许非本机回环客户端调用协议桥。该设置可能消耗已保存服务商的额度，通常应保持关闭。 |

---

## 本地单用户模式

AutoMeta 默认直接进入本地工作区。应用会在本地数据库中维护一个内部工作区身份，用于关联项目和会话。

---

## 安全检查清单

在将 AutoMeta 部署到网络（而非仅 `localhost`）之前，请检查以下事项：

1. **`API_KEY`** — 非本机部署应考虑设置 API 密钥。
2. **`HOST` + `CORS_ORIGINS`** — 除非反向代理需要访问后端，否则保持 `HOST=127.0.0.1`。如需暴露服务，请设置精确的 `CORS_ORIGINS` 白名单。
3. **`WORKSPACES_ROOT` + `MEDAUTODATA_LOCK_PROJECT_PATHS`** — 托管环境应限制项目文件的可访问范围。
4. **`.gitignore`** — 确认 `.env` 已列入 `.gitignore`，防止密钥被提交。
5. **HTTPS** — 暴露到公网时，请使用带 TLS 的反向代理。

---

## 故障排除

- 变量未生效？检查是否有同名的系统环境变量在覆盖它。
- 数据库错误？请参阅 [FAQ — SQLITE_CANTOPEN](./faq.zh-CN.md#8-数据库权限错误sqlite_cantopen)。
