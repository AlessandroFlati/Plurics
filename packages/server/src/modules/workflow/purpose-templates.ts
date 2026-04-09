import type { DagNode, WorkflowConfig } from './types.js';
import { buildSignalFilename } from './utils.js';

/**
 * Generate a generic purpose.md for an agent.
 * Domain-specific enrichment happens via the plugin's onPurposeGenerate hook.
 *
 * The signal protocol instructions are in shared_context (read once per session).
 * Only the per-agent signal template (with agent name, scope, filename) is injected here.
 */
export function generatePurpose(
  node: DagNode,
  workflowConfig: WorkflowConfig,
  presetContent: string,
): string {
  const sections: string[] = [];

  // 1. Role from preset
  sections.push(`# Role: ${node.name}\n\n${presetContent}`);

  // 2. Shared context (includes signal protocol instructions)
  if (workflowConfig.shared_context) {
    sections.push(`## Shared Context\n\n${workflowConfig.shared_context}`);
  }

  // 3. Scope context
  if (node.scope) {
    sections.push(`## Your Scope\n\nYou are working on: **${node.scope}**`);
  }

  // 4. Per-agent signal template (compact: just the JSON + filename)
  const signalFilename = buildSignalFilename(node);
  sections.push(generateSignalTemplate(node, signalFilename));

  // 5. Retry context
  if (node.retryCount > 0 && node.signal?.error) {
    sections.push([
      `## Previous Attempt (FAILED)`,
      `Attempt: ${node.retryCount + 1} of ${node.maxRetries + 1}`,
      `Error category: ${node.signal.error.category}`,
      `Error message: ${node.signal.error.message}`,
      `\nAnalyze what went wrong and take a different approach.`,
    ].join('\n'));
  }

  return sections.join('\n\n---\n\n');
}

/**
 * Signal protocol instructions (generic, goes into shared_context YAML field).
 * Called once per workflow, not per agent. Export for use by YAML generators.
 */
export function getSignalProtocolInstructions(): string {
  return `## Signal Protocol (ALL agents must follow)

When you complete your task, follow these steps IN ORDER:

1. Write output files via temp + rename: \`cat > .caam/{path}.tmp << 'EOF' ... EOF && mv .caam/{path}.tmp .caam/{path}\`
2. Verify JSON outputs: \`python3 -c "import json; json.load(open('.caam/{path}'))"\`
3. Compute SHA-256 and size: \`sha256sum .caam/{path} | cut -d' ' -f1\` and \`wc -c < .caam/{path}\`
4. Write signal file (ALWAYS LAST) using your per-agent template below, via temp + rename.

CRITICAL RULES:
- NEVER write the signal file before all outputs are written
- ALWAYS use .tmp + mv (atomic rename)
- Compute sha256 AFTER mv
- Use EXACT field names: size_bytes (NOT size), outputs[].path relative to .caam/
- On unrecoverable error, still write a signal with status "failure"`;
}

function generateSignalTemplate(node: DagNode, signalFilename: string): string {
  const agentName = node.name;

  const signalTemplate = JSON.stringify({
    schema_version: 1,
    signal_id: `sig-YYYYMMDDTHHMMSS-${agentName}-XXXX`,
    agent: agentName,
    scope: node.scope ?? null,
    status: "success",
    decision: null,
    outputs: [{ path: "shared/...", sha256: "COMPUTE", size_bytes: 0 }],
    metrics: { duration_seconds: 0, retries_used: node.retryCount },
    error: null,
  }, null, 2);

  return `## Your Signal Template

Signal filename: \`${signalFilename}\`
Write to: \`.caam/shared/signals/${signalFilename}\` (via .tmp + mv)

\`\`\`json
${signalTemplate}
\`\`\`

Replace: YYYYMMDDTHHMMSS with timestamp, XXXX with 4 hex chars, fill outputs/metrics.`;
}
