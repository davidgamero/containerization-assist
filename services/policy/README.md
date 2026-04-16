# Policy Service

Go sidecar that evaluates user-authored Rego policies for the containerization-assist HTTP server. Ships as a container; the API server reaches it via `CA_POLICY_SERVICE_URL` (default `http://policy:7070` in docker-compose).

## Why a sidecar?

Arbitrary user-authored Rego cannot be evaluated in-process from Node without shelling out to `opa` or loading WASM at eval time. Built-in presets (e.g. image-allowlist) are handled by TS evaluators and do not need this service. This sidecar only runs when custom Rego is submitted.

## API

### `POST /v1/evaluate`

Evaluates a Rego module against an input document.

**Request**
```json
{
  "rego": "package foo\n\nviolations contains {\"rule\": \"x\", \"message\": \"y\"} if ...",
  "input": { "any": "json" }
}
```

**Response `200`**
```json
{
  "violations": [{ "rule": "x", "message": "y", "path": "" }],
  "warnings": [],
  "raw": { "...": "..." },
  "evaluatedInMs": 4
}
```

**Response `400`** (Rego compile/parse failure)
```json
{ "code": "rego_parse_error", "message": "...", "line": 3, "col": 12 }
```

### `POST /v1/compile`

Parse + type-check only (for UI validate button). Same error shape as evaluate.

**Response `200`**: `{ "ok": true }`

### `GET /v1/healthz`

`200 ok` plain text.

## Operational limits

- Request body cap: 1 MiB (`http.MaxBytesReader`).
- Per-request eval budget: 5s.
- Listen address: `:7070` by default (override via `POLICY_SERVICE_ADDR`).

## Build

```bash
docker build -t ca-policy:dev services/policy
docker run --rm -p 7070:7070 ca-policy:dev
curl http://localhost:7070/v1/healthz
```

## Roadmap

- **Phase 2**: LRU compile cache keyed on SHA-256 of module source.
- **Phase 3**: TS client adapter that conforms to `RegoRunner` so `src/http/policies/rego-runner.ts` can transparently delegate when `CA_POLICY_SERVICE_URL` is set.
- **Phase 4**: `POST /v1/policies/validate` proxy in the API server + CodeMirror authoring UI.
