---
layout: doc
---

# REST API Reference

The Containerization Assist API server exposes REST endpoints for tool execution, job management, policy configuration, and health checks.

## Base URL

```
http://localhost:3000
```

## Authentication

If `CA_API_KEY` is set, all `/api/*` endpoints require:

```
Authorization: Bearer <your-api-key>
```

Health endpoints (`/health`, `/ready`) are unauthenticated.

## Health Endpoints

### `GET /health`

Liveness probe. Returns 200 if the process is running.

```json
{ "status": "ok" }
```

### `GET /ready`

Readiness probe. Checks Docker and Kubernetes connectivity.

```json
{
  "status": "healthy",
  "tools": 11,
  "message": "11 tools loaded",
  "dependencies": {
    "docker": { "available": true, "version": "27.0.3" },
    "kubernetes": { "available": true, "version": "v1.30.0" }
  }
}
```

## Tool Endpoints

### `GET /api/tools`

List all available containerization tools.

### `POST /api/tools/:toolName`

Execute a single tool synchronously.

**Path params:** `toolName` — one of: `analyze-repo`, `generate-dockerfile`, `fix-dockerfile`, `build-image-context`, `scan-image`, `tag-image`, `push-image`, `generate-k8s-manifests`, `prepare-cluster`, `verify-deploy`, `ops`

**Body:** Tool-specific parameters (see tool schemas)

**Response:**
```json
{ "success": true, "result": { ... } }
```

## Job Endpoints

### `POST /api/agent/run`

Start an AI-driven containerization pipeline. Supports three repo source modes.

**Git clone (recommended):**
```json
{
  "repositoryUrl": "https://github.com/org/repo",
  "gitRef": "main",
  "gitToken": "ghp_xxx",
  "registry": "myacr.azurecr.io",
  "namespace": "test-myapp",
  "imageName": "myapp"
}
```

- `repositoryUrl` — Git HTTPS URL (required, unless `repositoryPath` is used)
- `gitRef` — Branch, tag, or commit (optional, defaults to repo's default branch)
- `gitToken` — GitHub PAT or App installation token for private repos (optional; public repos need no token)

**Local path (dev/testing):**
```json
{
  "repositoryPath": "/path/to/repo",
  "registry": "myacr.azurecr.io",
  "namespace": "test-myapp"
}
```

Required: (`repositoryUrl` or `repositoryPath`), `registry`, `namespace`

**Response (202):**
```json
{
  "jobId": "uuid",
  "status": "pending",
  "source": { "type": "git", "gitUrl": "https://github.com/org/repo", "localPath": "/app/.data/workspaces/git-abc123" },
  "message": "Agent loop job created and queued",
  "pollUrl": "/api/jobs/uuid"
}
```

### `POST /api/agent/upload`

Upload a zip/tar.gz archive and start a containerization job. Uses `multipart/form-data`.

**Form fields:**
- `file` — Archive file (`.zip`, `.tar.gz`, `.tgz`)
- `registry` — Container registry (required)
- `namespace` — Target K8s namespace (required)
- `imageName` — Image name (optional)

**Example with curl:**
```bash
curl -X POST http://localhost:3000/api/agent/upload \
  -F "file=@my-project.zip" \
  -F "registry=myacr.azurecr.io" \
  -F "namespace=test-myapp"
```

### `GET /api/jobs`

List all jobs. Query params: `limit` (default 50), `offset` (default 0).

**Response:**
```json
{
  "jobs": [
    {
      "id": "uuid",
      "status": "running",
      "input": { ... },
      "stepCount": 3,
      "artifactCounts": { "dockerfiles": 1, "k8sManifests": 0, "helmCharts": 0 },
      "validationIssues": 0,
      "summary": null,
      "createdAt": "2026-04-10T...",
      "error": null
    }
  ]
}
```

### `GET /api/jobs/:id`

Get full job details including pipeline context, steps, and artifact revisions.

The response includes:
- `steps[]` — Each tool execution with input, result, duration, and success status
- `pipelineContext.artifacts` — Existing artifacts detected before the pipeline started
- `pipelineContext.validations[]` — Policy validation results after each stage
- `pipelineContext.artifactRevisions[]` — How generated artifacts evolved through the pipeline

### `POST /api/jobs/:id/cancel`

Cancel a running or pending job.

### `DELETE /api/jobs/:id`

Delete a completed job.

## Policy Endpoints

### `GET /api/policy`

List all active policies (built-in and custom).

```json
{
  "policies": [
    { "name": "base-images", "path": "/app/policies/base-images.rego", "size": 4521, "source": "built-in" },
    { "name": "my-custom", "path": "/app/.data/policies/my-custom.rego", "size": 890, "source": "custom" }
  ],
  "policyDir": "/app/.data/policies"
}
```

### `GET /api/policy/:name`

View the content of a specific policy.

### `GET /api/policy/base-images`

Get the current allowed base images configuration.

```json
{ "images": ["mcr.microsoft.com/", "node:22-alpine"], "active": true }
```

### `PUT /api/policy/base-images`

Set allowed base images. Automatically generates a Rego policy.

**Body:**
```json
{ "images": ["mcr.microsoft.com/", "node:22-alpine", "python:3.12-slim"] }
```

Pass an empty array to disable the restriction.

### `POST /api/policy/upload`

Upload a custom OPA Rego policy.

**Body:**
```json
{
  "name": "security-requirements",
  "content": "package containerization.security\n\nviolations contains result if {\n  ...\n}"
}
```

### `DELETE /api/policy/:name`

Delete a custom policy. Built-in policies cannot be deleted.

## Configuration Endpoint

### `GET /api/config`

Get current service configuration (sanitized — no secrets).

```json
{
  "tools": ["analyze-repo", "generate-dockerfile", ...],
  "toolCount": 11,
  "dependencies": { "docker": { "available": true }, "kubernetes": { "available": true } },
  "llm": { "configured": true, "model": "gpt-4o", "baseUrl": "my-endpoint.openai.azure.com" }
}
```
