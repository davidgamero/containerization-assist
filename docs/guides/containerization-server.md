# Containerization Server

The Containerization Server is the standalone HTTP backend for containerization-assist. It provides a full, end-to-end pipeline for containerizing applications through a REST API and Server-Sent Events (SSE). Unlike the Model Context Protocol (MCP) mode which exposes individual tools, the server mode manages the entire lifecycle from repository cloning to manifest generation.

## Getting Started

Run the server using the CLI:

```bash
# Development mode
npx tsx src/cli/cli.ts serve

# Production mode
npx containerization-assist-mcp serve
```

For a full local environment including the React frontend, use the development script:

```bash
./dev.sh
```

## Architecture

The backend is built with Hono and runs on port 3000 by default. It uses an in-memory `SessionStore` to track active containerization jobs.

### Pipeline Phases

The pipeline transitions through these states:
1. `pending`: Initial state upon creation.
2. `cloning`: Downloading the source code.
3. `analyzing`: Detecting frameworks and dependencies.
4. `generating_dockerfile`: Creating the Dockerfile.
5. `building`: Executing the Docker build.
6. `scanning`: Running security vulnerability scans.
7. `generating_manifests`: Creating Kubernetes/Helm manifests.
8. `complete`: Pipeline finished successfully.

### Artifact Storage

Artifacts generated during the pipeline (Dockerfiles, logs, manifests) are stored in a local workspace directory and served via the `/v1/artifacts` endpoint.

## API Reference

### Sessions
| Endpoint | Method | Description |
|----------|--------|-------------|
| `/v1/sessions` | GET | List all active and past sessions |
| `/v1/sessions` | POST | Start a new containerization session |
| `/v1/sessions/:id` | GET | Get detailed status of a specific session |
| `/v1/sessions/:id/events` | GET | SSE stream for real-time status updates |

### Policies
| Endpoint | Method | Description |
|----------|--------|-------------|
| `/v1/policies/global` | GET | Retrieve global policy configuration |
| `/v1/policies/global` | PUT | Update global policies |
| `/v1/sessions/:id/policies` | PATCH | Override policies for a specific session |
| `/v1/policy-presets` | GET | List available policy templates |

### Artifacts
| Endpoint | Method | Description |
|----------|--------|-------------|
| `/v1/artifacts/:id/:path` | GET | Download a specific artifact file |

## Policy System

Policies enforce security and compliance standards across all generated artifacts. They are evaluated per-artifact during the relevant pipeline phase.

### Scopes and Types
- **Global Scope**: Applies to all sessions unless overridden.
- **Session Scope**: Specific constraints for a single job.
- **Skill Policies**: Logic-based rules implemented in TypeScript.
- **Rego Policies**: Declarative rules using the Open Policy Agent (OPA) syntax.

### Target Types
Policies target specific outputs:
- `dockerfile`: Base image restrictions, user permissions.
- `manifest`: Resource limits, security contexts.
- `package`: Prohibited library versions.
- `any`: Universal project constraints.

## Frontend

The web interface is a React application using Tailwind CSS and Vite.
- **Vite Dev Server**: Runs on port 5173.
- **Proxy**: Automatically routes requests from `/v1` to the Hono backend on port 3000.

## Configuration

Set these environment variables before starting the server:

| Variable | Description |
|----------|-------------|
| `LLM_API_KEY` | API key for the language model provider |
| `LLM_BASE_URL` | Endpoint for the LLM API |
| `LLM_MODEL` | Specific model to use (e.g., gpt-4o) |
| `DOCKER_SOCKET` | Path to the Docker daemon socket (default: /var/run/docker.sock) |
| `KUBECONFIG` | Path to Kubernetes configuration for manifest validation |
| `GITHUB_CLIENT_ID` | OAuth ID for repository access |
| `GITHUB_CLIENT_SECRET` | OAuth secret for repository access |

### Demo Mode

If GitHub OAuth credentials are not provided, the server runs in Demo Mode. Users can still containerize applications by uploading local source files or selecting from provided example repositories.
