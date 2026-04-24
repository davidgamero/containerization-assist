/**
 * Shared step helpers and prompt assembly for dev-loop prompts.
 *
 * Each helper returns a { heading, body } pair for one workflow step.
 * `assemblePrompt` numbers them dynamically and joins everything.
 */

import { TOOL_NAME } from '@/tools';

export interface Step {
  heading: string;
  body: string;
}

// ---------------------------------------------------------------------------
// Azure pre-flight steps (used by aks-loop, available to kind-loop)
// ---------------------------------------------------------------------------

/**
 * Pre-flight step: Azure subscription selection and validation.
 *
 * Uses `vscode_askQuestions` (or plain text fallback) to present the user
 * with a picker showing the current default subscription plus any others
 * visible in `az account list`. Validates the chosen subscription exists
 * and is accessible before proceeding.
 */
export function azureSubscriptionStep(): Step {
  return {
    heading: 'Select and validate the Azure subscription',
    body: [
      '1. Run `az account show --query "{id:id, name:name}" -o json` to detect the **current default subscription**.',
      '2. Run `az account list --query "[?state==\'Enabled\'].{id:id, name:name}" -o json` to list all available subscriptions.',
      '3. Present a picker to the user (use `vscode_askQuestions` if available, otherwise plain text):',
      '   - **Default option (pre-selected):** the current subscription (`<name> (<id>)`)',
      '   - **Additional options:** other subscriptions from the list (if any)',
      '   - **Free-text input:** allow the user to type a subscription ID or name manually',
      '4. **Validate** the selected subscription:',
      '   - Run `az account show --subscription "<selected-id>" --query id -o tsv`',
      '   - If the command fails, inform the user the subscription was not found or is not accessible, and re-prompt.',
      '5. **Set** the subscription as the active context: `az account set --subscription "<selected-id>"`',
      '6. Confirm to the user: "Using subscription **<name>** (`<id>`)."',
    ].join('\n'),
  };
}

/**
 * Pre-flight step: AKS cluster selection and validation.
 *
 * Lists clusters in the selected resource group, presents a picker,
 * validates the cluster exists, detects AKS SKU (Automatic vs Standard),
 * and ensures kubeconfig points to the correct cluster.
 */
export function aksClusterValidationStep(): Step {
  return {
    heading: 'Select and validate the AKS cluster',
    body: [
      '1. Run `az aks list -g <resourceGroup> --query "[].{name:name, sku:sku.name, fqdn:fqdn}" -o json` to list AKS clusters in the resource group.',
      '2. Present a picker to the user:',
      '   - **Default option:** the cluster name provided in the prompt arguments (if any), or the first cluster in the list',
      '   - **Additional options:** other clusters in the resource group',
      '   - **Free-text input:** allow the user to type a cluster name manually',
      '3. **Validate** the selected cluster exists:',
      '   - Run `az aks show -g <resourceGroup> -n "<selectedCluster>" --query "{name:name, fqdn:fqdn, sku:sku.name, azureRbac:aadProfile.enableAzureRbac, localAccountsDisabled:disableLocalAccounts}" -o json`',
      '   - If the command fails, inform the user and re-prompt.',
      '4. **Record cluster metadata** for downstream steps:',
      '   - `isAutomatic` = (`sku` == `"Automatic"`) — affects manifest generation and RBAC strategy',
      '   - `isAzureRbac` = (`azureRbac` == `true`) — affects permission checks and `command invoke` guidance',
      '   - `localAccountsDisabled` = (`localAccountsDisabled` == `true`) — suppresses `--admin` kubeconfig suggestions',
      '5. **Validate kubeconfig context** points to this cluster:',
      "   - Compare `fqdn` from `az aks show` against `kubectl config view --minify -o jsonpath='{.clusters[0].cluster.server}'`",
      '   - If they differ, run `az aks get-credentials -g <resourceGroup> -n "<selectedCluster>" --overwrite-existing`',
      '   - If `localAccountsDisabled` is true, do NOT pass `--admin` (it will be rejected)',
      '6. **Verify connectivity**: run `kubectl get nodes --no-headers` and confirm nodes are listed.',
    ].join('\n'),
  };
}

/**
 * Pre-flight step: ACR selection and validation.
 *
 * Lists registries in the subscription, presents a picker, validates
 * the registry exists and the AKS cluster can pull from it.
 */
export function acrValidationStep(): Step {
  return {
    heading: 'Select and validate the Azure Container Registry',
    body: [
      '1. Run `az acr list --query "[].{name:name, loginServer:loginServer}" -o json` to list all ACRs in the subscription.',
      '2. Present a picker to the user:',
      '   - **Default option:** the registry provided in the prompt arguments (if any, matched by login server), or the first ACR in the list',
      '   - **Additional options:** other ACRs in the subscription',
      '   - **Free-text input:** allow the user to type a registry login server manually (e.g., `myregistry.azurecr.io`)',
      '3. **Validate** the selected ACR exists:',
      '   - Run `az acr show --name "<selectedAcr>" --query "{name:name, loginServer:loginServer}" -o json`',
      '   - If the command fails, inform the user and re-prompt.',
      '4. **Validate AKS→ACR pull authorization**:',
      '   - Run `az aks check-acr -g <resourceGroup> -n <clusterName> --acr <loginServer>`',
      '   - If the check **fails**, attempt to attach: `az aks update -g <resourceGroup> -n <clusterName> --attach-acr <acrName>`',
      '   - If attach **also fails** (e.g., `AuthorizationFailed`), inform the user:',
      '     > "The AKS cluster cannot pull from this ACR. Attaching requires **Owner** or **User Access Administrator** role on the ACR resource (not just the cluster). Ask someone with that role to run: `az aks update -g <rg> -n <cluster> --attach-acr <acr>`"',
      '   - Do NOT proceed past this step until ACR pull is confirmed.',
      '5. Confirm to the user: "Using ACR **<loginServer>**. Cluster pull access verified."',
    ].join('\n'),
  };
}

// ---------------------------------------------------------------------------
// RBAC pre-deployment check (AKS-specific)
// ---------------------------------------------------------------------------

/**
 * Check Azure RBAC data plane permissions for the target namespace
 * before attempting deployment. Handles both pre-existing and new namespaces.
 */
export function aksRbacPreDeployCheck(): Step {
  return {
    heading: 'Verify Azure RBAC data plane permissions',
    body: [
      '1. Check if the target namespace already exists: `kubectl get namespace <namespace> --no-headers`',
      '2. **If the namespace exists**, check write permissions within it:',
      '   - `kubectl auth can-i create deployments -n <namespace>`',
      '   - `kubectl auth can-i create services -n <namespace>`',
      '3. **If the namespace does NOT exist**, additionally check:',
      '   - `kubectl auth can-i create namespaces` (cluster-scoped)',
      '4. If any check returns `no`, surface the exact remediation:',
      '   - For namespace-scoped access:',
      '     ```',
      '     az role assignment create \\',
      '       --role "Azure Kubernetes Service RBAC Writer" \\',
      '       --assignee <principal> \\',
      '       --scope ".../managedClusters/<cluster>/namespaces/<namespace>"',
      '     ```',
      '   - For namespace creation (only if namespace does not exist):',
      '     ```',
      '     az role assignment create \\',
      '       --role "Azure Kubernetes Service RBAC Cluster Admin" \\',
      '       --assignee <principal> \\',
      '       --scope ".../managedClusters/<cluster>"',
      '     ```',
      '   - After the user grants roles, poll `kubectl auth can-i` every 10 seconds (up to 2 minutes) until permissions propagate.',
      '5. Do NOT proceed to deployment until all required permissions are confirmed.',
    ].join('\n'),
  };
}

// ---------------------------------------------------------------------------
// Kind kubeconfig validation
// ---------------------------------------------------------------------------

export function kindContextValidationStep(): Step {
  return {
    heading: 'Validate kubeconfig context targets the Kind cluster',
    body: [
      '1. Run `kubectl config current-context` to get the active context name.',
      '2. The expected context for a containerization-assist Kind cluster is `kind-containerization-assist`.',
      '3. If the current context does **not** match:',
      '   - Run `kind get clusters` to check if the `containerization-assist` cluster exists.',
      '   - If it exists, switch context: `kubectl config use-context kind-containerization-assist`',
      '   - If it does not exist, note this — the prepare-cluster step will create it.',
      '4. If the context matches, verify connectivity: `kubectl get nodes --no-headers`.',
      '   - If this fails, the cluster may be stopped or deleted — the prepare-cluster step will handle recreation.',
    ].join('\n'),
  };
}

// ---------------------------------------------------------------------------
// Shared steps (identical across loops)
// ---------------------------------------------------------------------------

export function analyzeStep(): Step {
  return {
    heading: 'Analyze the repository',
    body: [
      `Call **${TOOL_NAME.ANALYZE_REPO}** using the current working directory as the repository path.`,
      '- Confirm the detected repository, language, framework, modules, and existing Dockerfiles with the user before proceeding.',
      '- If the repository is a monorepo, list all independently deployable modules and ask the user which ones to target.',
    ].join('\n'),
  };
}

export function generateDockerfileStep(): Step {
  return {
    heading: 'Generate Dockerfile (if missing)',
    body: [
      'If no Dockerfile exists for the target module(s):',
      `1. Call **${TOOL_NAME.GENERATE_DOCKERFILE}** with the repository path and analysis context.`,
      "2. Follow the tool's guidance to create the Dockerfile(s) on disk.",
      '3. Retry up to **2 times** if generation fails.',
    ].join('\n'),
  };
}

export function scanStep(): Step {
  return {
    heading: 'Scan the image',
    body: [
      `1. Call **${TOOL_NAME.SCAN_IMAGE}** with the built image ID.`,
      `2. Review vulnerabilities. If critical/high issues are found, call **${TOOL_NAME.FIX_DOCKERFILE}** and rebuild. Retry up to **2 times**.`,
    ].join('\n'),
  };
}

export function deployStep(target: string): Step {
  return {
    heading: `Deploy to ${target}`,
    body: [
      '1. Ensure the namespace exists (idempotent): `kubectl create namespace <namespace> --dry-run=client -o yaml | kubectl apply -f -`',
      '2. Apply the generated manifests: `kubectl apply -f <manifest-folder> --namespace <namespace>`.',
      '3. Retry up to **2 times** on failure.',
    ].join('\n'),
  };
}

export function verifyStep(extraLines?: string[]): Step {
  const lines = [
    `1. Call **${TOOL_NAME.VERIFY_DEPLOY}** with the namespace to check pod status, readiness, and events.`,
    '2. If verification fails, inspect pod logs and events, fix issues, and re-deploy. Retry up to **2 times**.',
  ];
  if (extraLines) {
    lines.push(...extraLines);
  }
  return {
    heading: 'Verify the deployment',
    body: lines.join('\n'),
  };
}

// ---------------------------------------------------------------------------
// Shared rules
// ---------------------------------------------------------------------------

export const sharedRules = [
  '- **Retry failed steps at least 2 times** before reporting failure.',
  '- **Follow the chain hints** returned by each tool to determine next steps.',
  '- If a tool suggests calling another tool, follow that suggestion.',
  '- Keep the user informed of progress at each step.',
  '- If all retry attempts for a step are exhausted, report the failure clearly with diagnostic details.',
];

// ---------------------------------------------------------------------------
// Prompt assembly
// ---------------------------------------------------------------------------

/**
 * Assemble a complete loop prompt with dynamically numbered steps.
 */
export function assemblePrompt(
  title: string,
  contextLines: string[],
  steps: Step[],
  rules: string[],
): string {
  const numberedSteps = steps
    .map((s, i) => `### Step ${i + 1} — ${s.heading}\n${s.body}`)
    .join('\n\n');

  return `You are driving a **${title}** using the containerization-assist MCP server tools.

## Context
${contextLines.join('\n')}

## Workflow — follow each step in order

${numberedSteps}

## Important rules
${rules.join('\n')}`;
}
