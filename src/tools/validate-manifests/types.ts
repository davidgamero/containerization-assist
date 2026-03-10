import { validateManifestsInputSchema } from './schema';
import { TOOL_NAME, type IToolDefinition } from '../shared/toolDefinition';

export const validateManifestsToolDefinition = {
  name: TOOL_NAME.VALIDATE_MANIFESTS,
  description:
    'Validate Kubernetes manifests against policies and best practices. Supports inline manifests, file paths, or manifest plans with comprehensive tier-based validation.',
  category: 'kubernetes' as const,
  version: '1.0.0',
  schema: validateManifestsInputSchema,
  metadata: {
    knowledgeEnhanced: false,
  },
  chainHints: {
    success: 'Manifests validated successfully. Passed all policy checks and safeguard levels.',
    failure: 'Manifest validation failed. Review policy violations and safeguard warnings.',
  },
} satisfies IToolDefinition;
