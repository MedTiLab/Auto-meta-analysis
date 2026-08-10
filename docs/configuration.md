[English](./configuration.md) | [中文](./configuration.zh-CN.md)

# Configuration Reference

MedHelp® is configured through environment variables in a `.env` file at the project root. This guide documents every variable the application reads.

## How `.env` Loading Works

1. **Backend** — `server/load-env.js` reads `.env` line-by-line on startup and sets any key not already present in `process.env`. System environment variables always take precedence.
   On macOS/Linux, the backend also imports command-resolution variables such as `PATH`, `PYENV_*`, `CONDA_*`, `VIRTUAL_ENV`, and `HOMEBREW_*` from your login shell once at startup so GUI launches can still find tools installed through shell profiles.
2. **Frontend** — Vite loads `.env` automatically. Only variables prefixed with `VITE_` are exposed to browser code.
3. **Precedence** — System env > `.env` file values.

> **Quick start:** `cp .env.example .env` gives you sensible defaults. See the [Quickstart guide](./quickstart.md) for a step-by-step walkthrough.

---

## Configuration Reference

### Server

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `HOST` | No | `127.0.0.1` | Server bind host. Set to `0.0.0.0` only behind a trusted reverse proxy and after setting `JWT_SECRET`. |
| `PORT` | No | `3001` | Express API + WebSocket server port. |
| `VITE_PORT` | No | `5173` | Vite dev server port (development only). |
| `CORS_ORIGINS` / `CORS_ORIGIN` | No | Loopback origins only | Comma-separated browser origins allowed to call the API cross-origin, for example `https://medhelp.example.com`. |
| `CLAUDE_CLI_PATH` | No | `claude` | Absolute or relative path to the Claude Code binary. Override if `claude` is not on your `PATH`. |
| `CURSOR_CLI_PATH` | No | Auto-detect (`cursor-agent`, then `cursor agent`, then `agent`) | Override Cursor CLI command/binary. Useful when your environment only provides one alias. |
| `GEMINI_CLI_PATH` | No | `gemini` | Override Gemini CLI command/binary. Useful when your shell resolves Gemini through a custom alias or path. |
| `CODEX_CLI_PATH` | No | `codex` | Override Codex CLI command/binary. Useful when Codex is installed outside your default `PATH`. |
| `MEDAUTODATA_LOGIN_SHELL` | No | Auto-detect (`$SHELL`, then account login shell, then platform default) | Override which shell is used to import the login-shell environment at backend startup. Useful if Python or package managers are only configured in one shell profile. |
| `MEDAUTODATA_DISABLE_LOGIN_SHELL_ENV_IMPORT` | No | `0` | Set to `1` to disable importing `PATH` and Python/package-manager variables from the login shell at startup. |

### Database

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `DATABASE_PATH` | No | `server/database/auth.db` | Absolute path to the SQLite database file. The directory is created automatically if it does not exist. |

### Authentication

> These variables are **security-sensitive**. See the [Security Checklist](#security-checklist) below.

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `JWT_SECRET` | **Yes** (production) | `claude-ui-dev-secret-change-in-production` | Secret used to sign and verify JWT tokens. **Must** be changed before exposing MedHelp® outside localhost. Generate one with: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` |
| `API_KEY` | No | *(none — validation skipped)* | When set, every HTTP request must include an `X-Api-Key` header with this value. Useful for restricting access in hosted setups. |

### Context Window

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `CONTEXT_WINDOW` | No | `160000` | Maximum token context window sent to the backend CLI process. |
| `VITE_CONTEXT_WINDOW` | No | `160000` | Same value exposed to the frontend (must match `CONTEXT_WINDOW`). |

### Platform Mode

Platform mode is an advanced deployment option. Most users should leave these commented out.

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `VITE_IS_PLATFORM` | No | `false` | Set to `true` to enable Platform mode. In this mode JWT authentication is bypassed and the first database user is used for all requests. |
| `WORKSPACES_ROOT` | No | User home directory (`os.homedir()`) | Root directory where MedHelp® looks for and creates project workspaces. Only meaningful when `VITE_IS_PLATFORM=true`. |
| `MEDAUTODATA_LOCK_PROJECT_PATHS` | No | `false` | Set to `true` to force new projects into the single configured `WORKSPACES_ROOT`. No username or user-id subfolder is added. |

### Integrations

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `GEMINI_API_KEY` | No | *(none)* | Gemini API key used for image generation and other direct Gemini API requests. |
| `GEMINI_API_BASE_URL` | No | `https://generativelanguage.googleapis.com` | Override the Gemini API base URL. Use this when routing Gemini-compatible traffic through a third-party gateway such as `https://api.go-model.com`. Set it to the gateway root URL, not the full `models/...` path. |
| `GOOGLE_API_KEY` | No | *(none)* | Legacy alias for `GEMINI_API_KEY`. Still supported for compatibility with older scripts and Gemini CLI conventions. |
| `OPENAI_API_KEY` | No | *(none)* | OpenAI API key for Codex integration. Required only if you use the Codex CLI backend. |

### Advanced

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `CLAUDE_TOOL_APPROVAL_TIMEOUT_MS` | No | `55000` | Timeout in milliseconds for Claude tool-approval prompts before auto-declining. |
| `MEDAUTODATA_ENABLE_SYSTEM_UPDATE` | No | `false` | Enables the authenticated `/api/system/update` endpoint, which runs package update commands on the server. Leave disabled for hosted deployments. |

### LLM providers

The authenticated `/api/providers` backend manages Claude-compatible and OpenAI-compatible providers. It includes the complete preset catalog for Claude Official, DeepSeek, Zhipu GLM, Kimi, MiniMax, JiekouAI, ShengSuanYun, TeamoRouter, LM Studio, Ollama, and custom endpoints, plus built-in ChatGPT Official and Grok Official OAuth providers. OpenAI Chat Completions, OpenAI Responses, and Azure OpenAI Responses endpoints are translated through a loopback-only Anthropic Messages bridge, including tool calls, images, reasoning blocks, usage, and SSE streaming. Native Agent SDK cloud routing for Amazon Bedrock, Google Vertex AI, and Microsoft Foundry remains available through managed provider settings or process environment variables such as `CLAUDE_CODE_USE_BEDROCK`, `CLAUDE_CODE_USE_VERTEX`, and `CLAUDE_CODE_USE_FOUNDRY`.

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `MEDAUTODATA_PROVIDER_DIR` | No | `<app-data>/llm` | Override the directory containing `providers.json` and official-provider OAuth files. Files are written atomically with owner-only permissions. |
| `LLM_PROVIDER_TEST_TIMEOUT_MS` | No | `30000` | Timeout for provider connectivity tests. |
| `LLM_PROVIDER_REQUEST_TIMEOUT_MS` | No | `300000` | Timeout while connecting to and reading an upstream provider request. |
| `MEDAUTODATA_ALLOW_REMOTE_PROVIDER_PROXY` | No | `false` | Allows non-loopback clients to call the provider protocol bridge. This can consume saved provider quota and should normally remain disabled. |

---

## OSS Mode vs Platform Mode

MedHelp® supports two authentication paths:

| | OSS Mode (default) | Platform Mode |
|---|---|---|
| **Who uses it** | Individual developers running MedHelp® locally | Hosted / multi-tenant deployments |
| **Auth flow** | Register/login with username + password; JWT issued per session | JWT auth bypassed; first DB user auto-selected |
| **Enable** | Default — no extra config needed | Set `VITE_IS_PLATFORM=true` |
| **`WORKSPACES_ROOT`** | Ignored | Defines the root directory for all project workspaces |

> In OSS mode the `WORKSPACES_ROOT` variable is ignored — MedHelp® discovers projects from Claude Code / Cursor / Codex session directories under the user's home folder.

---

## Security Checklist

Before deploying MedHelp® on a network (not just `localhost`), review the following:

1. **`JWT_SECRET`** — Replace the default with a strong random string. The default value is public and provides zero security.
2. **`API_KEY`** — Consider setting an API key to add an extra authentication layer.
3. **`HOST` + `CORS_ORIGINS`** — Keep `HOST=127.0.0.1` unless a reverse proxy needs backend access. If you expose it, set an exact `CORS_ORIGINS` allowlist.
4. **`WORKSPACES_ROOT` + `MEDAUTODATA_LOCK_PROJECT_PATHS`** — Set a trusted shared `WORKSPACES_ROOT` and enable `MEDAUTODATA_LOCK_PROJECT_PATHS=true` so new projects always use that one default location.
5. **`MEDAUTODATA_ENABLE_SYSTEM_UPDATE`** — Keep server-side self-update disabled unless this is a trusted single-user deployment.
6. **`.gitignore`** — Verify that `.env` is listed in `.gitignore` (it is by default) so secrets are never committed.
7. **HTTPS** — When exposing MedHelp® to the internet, place it behind a reverse proxy (e.g. Nginx, Caddy) with TLS termination.

---

## Troubleshooting

- Variable not taking effect? Check that there is no system environment variable with the same name overriding it.
- Database errors? See [FAQ — SQLITE_CANTOPEN](./faq.md#8-database-permission-errors-sqlite_cantopen).
- JWT issues? See [FAQ — JWT_SECRET security warning](./faq.md#11-jwt_secret-security-warning).
