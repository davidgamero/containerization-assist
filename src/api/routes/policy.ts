/**
 * Policy Management Routes
 *
 * Endpoints for configuring OPA/Rego policies:
 * - Allowed base images (quick setting)
 * - Custom Rego policy upload
 * - Active policy listing
 */

import type { FastifyInstance } from 'fastify';
import { promises as fs, mkdirSync } from 'node:fs';
import { join, basename } from 'node:path';
import type { Logger } from 'pino';

const POLICY_DIR = process.env.CUSTOM_POLICY_PATH || join(process.cwd(), '.data', 'policies');

function ensurePolicyDir(): void {
  mkdirSync(POLICY_DIR, { recursive: true });
}

/**
 * Generate a Rego policy for allowed base images.
 */
function generateBaseImagesPolicy(allowedImages: string[]): string {
  const patterns = allowedImages
    .map((img) => {
      // Escape regex special characters and build pattern
      const escaped = img.replace(/[.*+?^${}()|[\]\\]/g, '\\\\$&');
      return `  regex.match(\`(?im)FROM\\\\s+${escaped}\`, input.content)`;
    })
    .join('\n');

  return `package containerization.allowed_base_images

# Auto-generated: Allowed Base Images Policy
# Managed via Containerization Assist Web UI

policy_name := "Allowed Base Images"
policy_version := "1.0"
policy_category := "quality"
default enforcement := "mandatory"

# Allowed base image patterns
${allowedImages.map((img, i) => `allowed_image_${i} := ${JSON.stringify(img)}`).join('\n')}

# Detect if input is a Dockerfile
is_dockerfile if {
  contains(input.content, "FROM ")
}

# Check if image matches any allowed pattern
image_allowed if {
${patterns}
}

# Block images that don't match allowed list
violations contains result if {
  is_dockerfile
  not image_allowed

  result := {
    "rule": "allowed-base-images",
    "category": "quality",
    "priority": 100,
    "severity": "block",
    "message": concat("", ["Base image not in allowed list. Allowed: ", concat(", ", [${allowedImages.map((img) => JSON.stringify(img)).join(', ')}])]),
    "description": "Only approved base images may be used",
  }
}

default allow := false
allow if { count(violations) == 0 }
`;
}

export function registerPolicyRoutes(
  fastify: FastifyInstance,
  logger: Logger,
): void {
  // List active policies
  fastify.get('/api/policy', async () => {
    ensurePolicyDir();
    const policies: Array<{ name: string; path: string; size: number; source: string }> = [];

    // Scan custom policy dir
    try {
      const files = await fs.readdir(POLICY_DIR);
      for (const file of files) {
        if (!file.endsWith('.rego') || file.endsWith('_test.rego')) continue;
        const fullPath = join(POLICY_DIR, file);
        const stat = await fs.stat(fullPath);
        policies.push({
          name: file.replace('.rego', ''),
          path: fullPath,
          size: stat.size,
          source: 'custom',
        });
      }
    } catch {
      // Directory doesn't exist yet
    }

    // Scan built-in policies
    const builtinDir = join(process.cwd(), 'policies');
    try {
      const files = await fs.readdir(builtinDir);
      for (const file of files) {
        if (!file.endsWith('.rego') || file.endsWith('_test.rego')) continue;
        const fullPath = join(builtinDir, file);
        const stat = await fs.stat(fullPath);
        policies.push({
          name: file.replace('.rego', ''),
          path: fullPath,
          size: stat.size,
          source: 'built-in',
        });
      }
    } catch {
      // Built-in dir missing
    }

    return { policies, policyDir: POLICY_DIR };
  });

  // Get policy content
  fastify.get<{ Params: { name: string } }>(
    '/api/policy/:name',
    async (request, reply) => {
      const { name } = request.params;
      const filename = name.endsWith('.rego') ? name : `${name}.rego`;

      // Check custom dir first, then built-in
      for (const dir of [POLICY_DIR, join(process.cwd(), 'policies')]) {
        const fullPath = join(dir, filename);
        try {
          const content = await fs.readFile(fullPath, 'utf-8');
          return { name, content, path: fullPath };
        } catch {
          continue;
        }
      }

      return reply.status(404).send({ error: `Policy not found: ${name}` });
    },
  );

  // Get/Set allowed base images
  fastify.get('/api/policy/base-images', async () => {
    ensurePolicyDir();
    const policyPath = join(POLICY_DIR, 'allowed-base-images.rego');

    try {
      const content = await fs.readFile(policyPath, 'utf-8');
      // Extract images from the policy file
      const matches = content.match(/allowed_image_\d+ := "([^"]+)"/g);
      const images = (matches ?? []).map((m) => {
        const match = m.match(/"([^"]+)"/);
        return match ? match[1] : '';
      }).filter(Boolean);

      return { images, policyPath, active: true };
    } catch {
      return { images: [], policyPath, active: false };
    }
  });

  fastify.put<{ Body: { images: string[] } }>(
    '/api/policy/base-images',
    async (request, reply) => {
      const { images } = request.body;

      if (!Array.isArray(images)) {
        return reply.status(400).send({ error: 'images must be an array of strings' });
      }

      ensurePolicyDir();
      const policyPath = join(POLICY_DIR, 'allowed-base-images.rego');

      if (images.length === 0) {
        // Remove the policy if no images specified
        try {
          await fs.unlink(policyPath);
        } catch {
          // Already doesn't exist
        }
        logger.info('Allowed base images policy removed');
        return { success: true, active: false, images: [] };
      }

      const content = generateBaseImagesPolicy(images);
      await fs.writeFile(policyPath, content, 'utf-8');
      logger.info({ images, policyPath }, 'Allowed base images policy updated');

      return { success: true, active: true, images, policyPath };
    },
  );

  // Upload custom Rego policy
  fastify.post<{ Body: { name: string; content: string } }>(
    '/api/policy/upload',
    async (request, reply) => {
      const { name, content } = request.body;

      if (!name || !content) {
        return reply.status(400).send({ error: 'name and content are required' });
      }

      // Validate name
      const safeName = basename(name).replace(/[^a-zA-Z0-9._-]/g, '');
      const filename = safeName.endsWith('.rego') ? safeName : `${safeName}.rego`;

      // Basic Rego validation
      if (!content.includes('package ')) {
        return reply.status(400).send({
          error: 'Invalid Rego policy: must contain a package declaration',
        });
      }

      ensurePolicyDir();
      const policyPath = join(POLICY_DIR, filename);
      await fs.writeFile(policyPath, content, 'utf-8');
      logger.info({ filename, policyPath }, 'Custom policy uploaded');

      return { success: true, name: safeName, path: policyPath };
    },
  );

  // Delete custom policy
  fastify.delete<{ Params: { name: string } }>(
    '/api/policy/:name',
    async (request, reply) => {
      const { name } = request.params;
      const filename = name.endsWith('.rego') ? name : `${name}.rego`;
      const policyPath = join(POLICY_DIR, filename);

      try {
        await fs.unlink(policyPath);
        logger.info({ filename }, 'Custom policy deleted');
        return { success: true };
      } catch {
        return reply.status(404).send({ error: `Policy not found: ${name}` });
      }
    },
  );
}
