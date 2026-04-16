---
layout: doc
---

# Developer Guide

This guide covers how to develop, extend, and debug the Containerization Assist API server, Web UI, and AKS deployment.

## Project Structure

```
containerization-assist/
├── src/
│   ├── api/                    # HTTP API server (new)
│   │   ├── server.ts           # Fastify entry point
│   │   ├── agent/              # AI agent loop
│   │   │   ├── agent-loop.ts   # LLM ↔ tool orchestration
│   │   │   ├── llm-client.ts   # OpenAI-compatible client
│   │   │   ├── prompts.ts      # System prompts + tool defs
│   │   │   ├── pipeline-context.ts  # Cross-stage state
│   │   │   ├── artifact-scanner.ts  # Detect existing artifacts
│   │   │   └── types.ts
│   │   ├── jobs/               # Job queue + SQLite store
│   │   ├── repos/              # Repository ingestion
│   │   │   ├── ingestion.ts    # Git clone, zip upload, local path
│   │   │   └── types.ts
│   │   ├── routes/             # API route handlers
│   │   │   ├── agent.ts        # POST /api/agent/run, /upload
│   │   │   ├── health.ts       # GET /health, /ready
│   │   │   ├── jobs.ts         # Job CRUD
│   │   │   ├── policy.ts       # Policy management
│   │   │   └── tools.ts        # Tool execution
│   │   └── middleware/
│   │       └── auth.ts         # API key auth
│   ├── app/                    # Core application runtime
│   ├── cli/                    # MCP CLI (existing)
│   ├── tools/                  # 11 containerization tools
│   ├── infra/                  # Docker + K8s clients
│   ├── mcp/                    # MCP server (existing)
│   └── sdk/                    # SDK executor (existing)
├── web/                        # React SPA (new)
│   ├── src/
│   │   ├── App.tsx
│   │   ├── api/client.ts       # Typed API client
│   │   ├── pages/
│   │   │   ├── Dashboard.tsx
│   │   │   ├── NewJob.tsx
│   │   │   ├── JobDetail.tsx
│   │   │   └── PolicySettings.tsx
│   │   └── hooks/
│   │       └── useJobs.ts
│   ├── nginx.conf
│   └── vite.config.ts
├── deploy/
│   └── helm/containerization-assist/   # Helm chart
├── Dockerfile.api              # API server image
├── Dockerfile.web              # Web UI image
└── .github/workflows/
    └── build-deploy.yml        # CI/CD pipeline
```

## Local Development

### API Server

```bash
# Install dependencies
npm ci

# Start API server with hot reload
npm run dev:api

# Required env vars for agent loop:
export OPENAI_BASE_URL=https://your-endpoint.openai.azure.com/openai
export OPENAI_API_KEY=your-key
export OPENAI_MODEL=gpt-4o

# Optional:
export OPENAI_API_VERSION=2024-12-01-preview  # For Azure OpenAI
export CA_API_KEY=dev-key                      # Enable API auth
export LOG_LEVEL=debug
```

The API server starts on `http://localhost:3000`.

### Web UI

```bash
cd web
npm ci
npm run dev
```

The dev server starts on `http://localhost:5173` with hot module reload. API requests are proxied to `localhost:3000` via Vite config.

### Running Both Together

```bash
# Terminal 1: API server
npm run dev:api

# Terminal 2: Web UI
cd web && npm run dev
```

Open `http://localhost:5173` — the Vite dev server proxies `/api/*`, `/health`, and `/ready` to the API server.

## Architecture

### Data Flow

The tools don't directly pass data to each other — the **LLM is the orchestrator**. Each tool returns structured JSON that the LLM reads, then calls the next tool with appropriate parameters:

```
User submits job (git URL + registry + namespace)
  │
  ▼
Git clone → local workspace
  │
  ▼
Agent Loop starts (LLM + 11 tools):
  analyze-repo → RepositoryAnalysis (modules, language, frameworks)
       │
       ▼ LLM reads analysis, extracts language/deps
  generate-dockerfile → DockerfilePlan (recommendations, base images)
       │
       ▼ LLM creates/updates Dockerfile
  build-image-context → BuildImageResult (build command, security analysis)
       │
       ▼ LLM executes build command
  scan-image → ScanImageResult (vulnerabilities, fix actions)
       │
       ▼ LLM reads scan, decides to proceed or fix
  tag-image → TagImageResult (tagged image ref)
       │
       ▼
  push-image → PushImageResult (digest, pushed tag)
       │
       ▼
  generate-k8s-manifests → ManifestPlan (K8s resource recommendations)
       │
       ▼ LLM creates manifest files
  prepare-cluster → PrepareClusterResult (namespace, RBAC)
       │
       ▼ LLM applies manifests with kubectl
  verify-deploy → VerifyDeploymentResult (pods, endpoints, health)
```

### Pipeline Context

The `PipelineContext` (`src/api/agent/pipeline-context.ts`) accumulates typed outputs from each stage. After every tool call:

1. `updatePipelineContext()` extracts key outputs (image refs, scan results, etc.)
2. `VALIDATION_RULES[toolName]` runs policy checks
3. Validation results are attached to artifact revisions
4. `summarizePipelineContext()` builds a Markdown summary injected into the LLM conversation

### Repository Ingestion

`src/api/repos/ingestion.ts` handles three source modes:

| Mode | Entry Point | How It Works |
|------|-------------|--------------|
| **Git clone** | `POST /api/agent/run` with `repositoryUrl` | Shallow clones to `.data/workspaces/git-<id>`. Token injected as `x-access-token` in HTTPS URL for private repos. |
| **Upload** | `POST /api/agent/upload` (multipart) | Extracts .zip/.tar.gz to `.data/workspaces/upload-<id>`. Handles single-directory zips. |
| **Local** | `POST /api/agent/run` with `repositoryPath` | Validates path exists. No copy — works directly on the filesystem. |

### Job Queue

In-memory queue backed by SQLite (`src/api/jobs/`):
- Jobs are created with status `pending`, processed sequentially
- During execution, steps and pipeline context are persisted to SQLite on each tool completion
- AbortController supports cancellation
- SQLite uses WAL mode for concurrent read/write

### Policy System Integration

Policies flow through two paths:

1. **At generation time** — The existing orchestrator evaluates policies when `generate-dockerfile` and `generate-k8s-manifests` run. Results appear in `plan.policyValidation`.

2. **At the API level** — The agent loop's `VALIDATION_RULES` check tool outputs after each stage. Results are stored in `pipelineContext.validations[]` and shown in the UI.

Custom policies uploaded via the API are written to `CUSTOM_POLICY_PATH` (default: `.data/policies/`). The `CUSTOM_POLICY_PATH` env var makes the orchestrator pick them up automatically.

## Adding New Features

### Adding a New API Route

1. Create `src/api/routes/my-route.ts`
2. Export a `registerMyRoutes(fastify, ...)` function
3. Register it in `src/api/server.ts`
4. Add types to `web/src/api/client.ts`

### Adding a New Pipeline Validation Rule

Add an entry to `VALIDATION_RULES` in `src/api/agent/agent-loop.ts`:

```typescript
'my-tool': (result) => {
  const violations: string[] = [];
  // Check result properties
  if (result.someField === 'bad') {
    violations.push('someField has an invalid value');
  }
  return {
    stage: 'my-tool',
    passed: violations.length === 0,
    violations,
    warnings: [],
    timestamp: new Date().toISOString(),
  };
},
```

### Adding a New Web UI Page

1. Create `web/src/pages/MyPage.tsx`
2. Add route in `web/src/App.tsx`
3. Add nav link in the header

## Docker Builds

### API Server (`Dockerfile.api`)

Multi-stage build:
- **Builder**: `node:22-alpine`, full `npm ci` + `npm run build`
- **Runtime**: `node:22-alpine` with `git` and `docker-cli` installed
- Non-root user (`appuser:1001`)
- Health check on `/health`
- Entry point: `node dist/src/api/server.js`

### Web UI (`Dockerfile.web`)

Multi-stage build:
- **Builder**: `node:22-alpine`, Vite build
- **Runtime**: `nginx:alpine` serving static files
- nginx config proxies `/api/*` to the API service

## Testing

```bash
# Unit tests (existing — 2041 tests)
npm run test:unit

# Build verification
npm run build

# Lint
npm run lint

# Type check
npx tsc --noEmit
```

## Helm Chart Development

```bash
# Template rendering (dry run)
helm template containerization-assist deploy/helm/containerization-assist \
  --set secrets.openaiApiKey=test \
  --set llm.baseUrl=https://test.openai.azure.com

# Install with debug
helm upgrade --install containerization-assist deploy/helm/containerization-assist \
  --namespace ca-system --create-namespace --debug --dry-run

# Check release status
helm -n ca-system status containerization-assist
helm -n ca-system get values containerization-assist
```
