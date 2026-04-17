/**
 * Agent Prompts
 *
 * System prompts and tool definition builders for the AI agent loop.
 * Adapts the existing AKS loop prompt template for HTTP API context.
 */

import type { OpenAIToolDefinition } from './types.js';
import { zodToJsonSchema } from 'zod-to-json-schema';
import type { ZodTypeAny } from 'zod';

const SYSTEM_PROMPT = `You are a containerization assistant that helps users containerize their applications and deploy them to Kubernetes clusters.

You have access to a set of tools that cover the full containerization workflow:
1. **analyze-repo** — Detect language, framework, dependencies, and project structure
2. **generate-dockerfile** — Create an optimized Dockerfile based on analysis
3. **fix-dockerfile** — Fix issues in an existing Dockerfile
4. **build-image-context** — Prepare Docker build context and execute builds
5. **scan-image** — Scan built images for vulnerabilities
6. **tag-image** — Tag images for a target registry
7. **push-image** — Push images to a container registry
8. **generate-k8s-manifests** — Generate Kubernetes deployment manifests
9. **prepare-cluster** — Set up namespace, RBAC, and cluster prerequisites
10. **verify-deploy** — Apply manifests and verify deployment health

## Rules
- Always start with analyze-repo to understand the project before generating anything.
- Call tools one at a time and wait for results before deciding the next step.
- If a tool fails, analyze the error and either retry with adjusted parameters or call fix-dockerfile if the build fails due to Dockerfile issues.
- Retry up to 2 times on transient failures before giving up.
- When the full pipeline completes successfully, provide a summary of what was deployed and how to access it.
- Use linux/amd64 as the target platform for all builds.
- Never fabricate tool results — only report what the tools actually return.
- If you need information that no tool can provide, ask the user.`;

/**
 * Convert the internal tool registry to OpenAI-compatible tool definitions.
 */
interface ToolDef {
  name: string;
  description: string;
  schema: ZodTypeAny;
}

export function buildToolDefinitions(
  tools: ReadonlyArray<ToolDef>,
): OpenAIToolDefinition[] {
  return tools
    .filter((tool) => tool.name !== 'ops') // Exclude ops (internal diagnostics)
    .map((tool) => {
      // Use 'any' to avoid deep type instantiation issues with zod-to-json-schema
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const jsonSchema = zodToJsonSchema(tool.schema as any, {
        $refStrategy: 'none',
      }) as Record<string, unknown>;

      // Remove $schema and other metadata that OpenAI doesn't expect
      const { $schema: _, ...parameters } = jsonSchema;

      return {
        type: 'function' as const,
        function: {
          name: tool.name,
          description: tool.description,
          parameters,
        },
      };
    });
}

/**
 * Build the user prompt for a containerization job.
 */
export function buildJobPrompt(input: {
  repositoryPath: string;
  registry: string;
  namespace: string;
  imageName?: string | undefined;
  clusterName?: string | undefined;
  resourceGroup?: string | undefined;
}): string {
  const lines = [
    `Containerize and deploy the application at **${input.repositoryPath}** to Kubernetes.`,
    '',
    '## Configuration',
    `- Container registry: **${input.registry}**`,
    `- Target namespace: **${input.namespace}**`,
  ];

  if (input.imageName) {
    lines.push(`- Image name: **${input.imageName}**`);
  } else {
    lines.push('- Derive the image name from the repository directory name.');
  }

  if (input.clusterName) {
    lines.push(`- Cluster: **${input.clusterName}**`);
  }

  if (input.resourceGroup) {
    lines.push(`- Resource group: **${input.resourceGroup}**`);
  }

  lines.push(
    '',
    '## Instructions',
    'Run the full containerization pipeline:',
    '1. Analyze the repository',
    '2. Generate a Dockerfile',
    '3. Build the Docker image (platform: linux/amd64)',
    '4. Scan the image for vulnerabilities',
    '5. Tag the image for the target registry',
    '6. Push the image to the registry',
    '7. Prepare the cluster (create namespace, check permissions)',
    '8. Generate Kubernetes manifests',
    '9. Deploy and verify the application is running',
    '',
    'Report progress after each step. If any step fails, attempt to fix it before proceeding.',
  );

  return lines.join('\n');
}

export function getSystemPrompt(): string {
  return SYSTEM_PROMPT;
}
