import { buildImageSchema } from './schema';
import { TOOL_NAME, type IToolDefinition } from '../shared/toolDefinition';

export const buildImageContextToolDefinition = {
  name: TOOL_NAME.BUILD_IMAGE_CONTEXT,
  description:
    'Prepare Docker build context with security analysis and optimized build commands. Returns structured guidance for executing builds.',
  version: '3.0.0',
  schema: buildImageSchema,
  metadata: {
    knowledgeEnhanced: false,
  },
  chainHints: {
    success:
      'Build context prepared with security analysis and build command. Next: Execute the provided build command, then call scan-image to check for vulnerabilities.',
    failure:
      'Build context preparation failed. Check the Dockerfile path and build context directory exist and are accessible.',
  },
} satisfies IToolDefinition;
