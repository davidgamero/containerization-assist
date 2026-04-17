/**
 * Tool Execution Routes
 *
 * REST endpoints for listing and executing the 11 containerization tools.
 */

import type { FastifyInstance } from 'fastify';
import type { AppRuntime } from '@/types/runtime.js';
import type { ToolName } from '@/tools';

export function registerToolRoutes(
  fastify: FastifyInstance,
  app: AppRuntime,
): void {
  // List all available tools with their metadata
  fastify.get('/api/tools', async () => {
    const tools = app.listTools();
    return { tools };
  });

  // Execute a single tool synchronously
  fastify.post<{
    Params: { toolName: string };
    Body: Record<string, unknown>;
  }>('/api/tools/:toolName', async (request, reply) => {
    const { toolName } = request.params;
    const params = request.body;

    // Validate tool exists
    const tools = app.listTools();
    const tool = tools.find((t) => t.name === toolName);

    if (!tool) {
      return reply.status(404).send({
        error: `Tool not found: ${toolName}`,
        availableTools: tools.map((t) => t.name),
      });
    }

    try {
      const result = await app.execute(
        toolName as ToolName,
        params as never,
      );

      if (result.ok) {
        return { success: true, result: result.value };
      } else {
        return reply.status(422).send({
          success: false,
          error: result.error,
          guidance: 'guidance' in result ? result.guidance : undefined,
        });
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return reply.status(500).send({
        success: false,
        error: message,
      });
    }
  });
}
