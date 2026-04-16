---
layout: doc
---

# AKS Deployment Guide

Deploy Containerization Assist as a containerized service in Azure Kubernetes Service with a REST API, Web UI, and AI-driven containerization pipeline.

## Architecture

```
┌──────────────────────────────────────────────────┐
│  AKS Cluster                                      │
│                                                    │
│  ┌─────────────┐   ┌─────────────┐                │
│  │  Web UI Pod  │──▶│  API Server │──▶ OpenAI API  │
│  │ (React SPA)  │   │  (Fastify)  │                │
│  │ nginx:alpine │   │  + DinD     │──▶ K8s API     │
│  └─────────────┘   │  sidecar    │                │
│                     └─────────────┘                │
│                                                    │
│  ┌── app-ns-1 ──┐  ┌── app-ns-2 ──┐              │
│  │ Deployed app  │  │ Deployed app  │              │
│  └───────────────┘  └───────────────┘              │
└────────────────────────────────────────────────────┘
```

The service consists of two containers:
- **API Server** — Fastify HTTP server wrapping the 11 containerization tools, an AI agent loop, and a job queue with SQLite persistence
- **Web UI** — React SPA served via nginx, proxying API requests to the API server

Image builds run inside a **Docker-in-Docker sidecar** to avoid requiring host Docker socket access.

## Prerequisites

- An AKS cluster with `kubectl` access
- An Azure Container Registry (ACR)
- An OpenAI-compatible API endpoint and key (Azure OpenAI, OpenAI, vLLM, etc.)
- Helm 3.x installed locally

## Quick Start

### 1. Authenticate

```bash
# AKS credentials
az aks get-credentials --resource-group <rg> --name <cluster>

# ACR login
az acr login --name <acr-name>
```

### 2. Build and Push Images

```bash
# API server
docker build -t <acr>.azurecr.io/ca-api:v1 -f Dockerfile.api .
docker push <acr>.azurecr.io/ca-api:v1

# Web UI (install web deps first)
cd web && npm ci && cd ..
docker build -t <acr>.azurecr.io/ca-web:v1 -f Dockerfile.web .
docker push <acr>.azurecr.io/ca-web:v1
```

### 3. Deploy with Helm

```bash
helm upgrade --install containerization-assist \
  deploy/helm/containerization-assist \
  --namespace ca-system --create-namespace \
  --set api.image.repository=<acr>.azurecr.io/ca-api \
  --set api.image.tag=v1 \
  --set web.image.repository=<acr>.azurecr.io/ca-web \
  --set web.image.tag=v1 \
  --set secrets.openaiApiKey=<your-key> \
  --set llm.baseUrl=<your-endpoint> \
  --set llm.model=gpt-4o
```

### 4. Access the Service

```bash
# Port-forward to test locally
kubectl -n ca-system port-forward svc/containerization-assist-api 3000:3000
kubectl -n ca-system port-forward svc/containerization-assist-web 8080:80

# Open http://localhost:8080 in your browser
```

## Configuration Reference

### Helm Values

| Value | Default | Description |
|-------|---------|-------------|
| `replicaCount` | `1` | Replicas (use 1 for SQLite job store) |
| `api.image.repository` | `containerization-assist-api` | API container image |
| `api.image.tag` | `latest` | API image tag |
| `api.port` | `3000` | API server port |
| `api.resources.requests.cpu` | `200m` | API CPU request |
| `api.resources.requests.memory` | `256Mi` | API memory request |
| `api.resources.limits.cpu` | `1` | API CPU limit |
| `api.resources.limits.memory` | `1Gi` | API memory limit |
| `web.enabled` | `true` | Deploy the Web UI |
| `web.image.repository` | `containerization-assist-web` | Web UI image |
| `dind.enabled` | `true` | Enable Docker-in-Docker sidecar |
| `dind.storage` | `20Gi` | Docker image layer storage |
| `llm.baseUrl` | `""` | OpenAI-compatible API endpoint |
| `llm.model` | `gpt-4o` | LLM model name |
| `llm.apiVersion` | `""` | Azure OpenAI API version |
| `secrets.openaiApiKey` | `""` | LLM API key |
| `secrets.caApiKey` | `""` | Optional REST API authentication key |
| `rbac.create` | `true` | Create ClusterRole and binding |
| `ingress.enabled` | `false` | Create Ingress resource |
| `persistence.enabled` | `false` | Use PVC for SQLite (recommended for production) |

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `OPENAI_BASE_URL` | — | LLM API endpoint (required for agent loop) |
| `OPENAI_API_KEY` | — | LLM API key (required for agent loop) |
| `OPENAI_MODEL` | `gpt-4o` | Model name |
| `OPENAI_API_VERSION` | — | Azure OpenAI API version (e.g., `2024-12-01-preview`) |
| `CA_API_KEY` | — | API authentication key (optional; if unset, auth is disabled) |
| `LOG_LEVEL` | `info` | Logging level |
| `DATA_DIR` | `/app/.data` | SQLite database directory |
| `CUSTOM_POLICY_PATH` | — | Custom policy directory |
| `DOCKER_HOST` | `tcp://localhost:2376` | Docker daemon address (DinD sidecar) |

## RBAC Permissions

The Helm chart creates a ClusterRole granting the API server permissions to manage user application namespaces. Required because the tool dynamically creates namespaces and deploys user workloads:

| API Group | Resources | Verbs |
|-----------|-----------|-------|
| `""` (core) | namespaces, services, configmaps, secrets, serviceaccounts, pods, pods/log | get, list, create, update, patch, delete, watch |
| `apps` | deployments, statefulsets, daemonsets, replicasets | get, list, create, update, patch, delete, watch |
| `networking.k8s.io` | ingresses, ingressclasses | get, list, create, update, patch |
| `rbac.authorization.k8s.io` | roles, rolebindings | get, list, create, update, patch |
| `authorization.k8s.io` | selfsubjectaccessreviews | create |
| `batch` | jobs, cronjobs | get, list, create, update, patch, delete |

## Docker-in-Docker (DinD)

The API server communicates with a DinD sidecar over TLS:

- The `docker:27-dind` sidecar runs with `privileged: true` and auto-generates TLS certificates in a shared `emptyDir` volume
- The API container connects via `DOCKER_HOST=tcp://localhost:2376` with mutual TLS
- Image layers are stored in an `emptyDir` (or PVC for caching)

::: warning
DinD requires `privileged: true`. Ensure your AKS cluster's Pod Security Standards allow this in the `ca-system` namespace.
:::

## Production Considerations

### Persistence

Enable PVC for the SQLite job store to survive pod restarts:

```yaml
persistence:
  enabled: true
  size: 1Gi
  storageClass: managed-csi
```

### Ingress

```yaml
ingress:
  enabled: true
  className: nginx
  hosts:
    - host: containerization-assist.example.com
      paths:
        - path: /api
          pathType: Prefix
          service: api
        - path: /
          pathType: Prefix
          service: web
  tls:
    - secretName: ca-tls
      hosts:
        - containerization-assist.example.com
```

### Azure Key Vault Integration

Instead of passing secrets via Helm `--set`, use the Azure Key Vault CSI driver:

```yaml
# SecretProviderClass (create separately)
apiVersion: secrets-store.csi.x-k8s.io/v1
kind: SecretProviderClass
metadata:
  name: ca-secrets
spec:
  provider: azure
  parameters:
    keyvaultName: "my-keyvault"
    objects: |
      - objectName: openai-api-key
        objectType: secret
    tenantId: "<tenant-id>"
```

### API Authentication

Set `secrets.caApiKey` to require API key authentication on all `/api/*` endpoints. Clients must include `Authorization: Bearer <key>` in requests.

## CI/CD

The repository includes a GitHub Actions workflow (`.github/workflows/build-deploy.yml`) that:

1. Builds and tests TypeScript
2. Builds Docker images for API and Web
3. Pushes to ACR
4. Deploys to AKS via Helm

Required GitHub repository variables:
- `ACR_REGISTRY`, `AKS_CLUSTER`, `AKS_RESOURCE_GROUP`

Required GitHub secrets:
- `AZURE_CLIENT_ID`, `AZURE_TENANT_ID`, `AZURE_SUBSCRIPTION_ID` (for OIDC login)
- `OPENAI_API_KEY`, `OPENAI_BASE_URL`

## Troubleshooting

### Pod not starting

```bash
kubectl -n ca-system describe pod -l app.kubernetes.io/component=api
kubectl -n ca-system logs -l app.kubernetes.io/component=api -c api
kubectl -n ca-system logs -l app.kubernetes.io/component=api -c dind
```

### Docker builds failing

Check DinD sidecar logs and TLS cert volume:

```bash
kubectl -n ca-system logs -l app.kubernetes.io/component=api -c dind
kubectl -n ca-system exec -it deploy/containerization-assist-api -c api -- ls /certs/client/
```

### LLM connection errors

Verify the endpoint is reachable from the cluster:

```bash
kubectl -n ca-system exec -it deploy/containerization-assist-api -c api -- \
  node -e "fetch('$OPENAI_BASE_URL/models', {headers:{'api-key':'$OPENAI_API_KEY'}}).then(r=>console.log(r.status))"
```
