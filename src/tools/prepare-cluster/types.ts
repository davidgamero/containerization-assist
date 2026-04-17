import { prepareClusterSchema } from './schema';
import { TOOL_NAME, type IToolDefinition } from '../shared/toolDefinition';

export const prepareClusterToolDefinition = {
  name: TOOL_NAME.PREPARE_CLUSTER,
  description:
    'Inspect Kubernetes cluster state and return setup steps and validation commands for the agent to execute. Does not take direct action.',
  category: 'kubernetes' as const,
  version: '3.0.0',
  schema: prepareClusterSchema,
  metadata: {
    knowledgeEnhanced: false,
  },
  chainHints: {
    success:
      'Cluster inspection complete. Execute the returned setupSteps (skipping alreadyDone ones), then run each validationStep to confirm the cluster is ready. Finally, use `kubectl apply -f <manifest-folder>` to deploy, then call verify-deploy.',
    failure:
      'Cluster inspection found issues. Check connectivity, permissions, and namespace configuration.',
  },
} satisfies IToolDefinition;
