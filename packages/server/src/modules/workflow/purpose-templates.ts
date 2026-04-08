import type { DagNode, WorkflowConfig } from './types.js';
import { buildSignalFilename } from './utils.js';

/**
 * Generate a generic purpose.md for an agent.
 * Domain-specific enrichment happens via the plugin's onPurposeGenerate hook.
 */
export function generatePurpose(
  node: DagNode,
  workflowConfig: WorkflowConfig,
  presetContent: string,
): string {
  const sections: string[] = [];

  // 1. Role from preset
  sections.push(`# Role: ${node.name}\n\n${presetContent}`);

  // 2. Shared context
  if (workflowConfig.shared_context) {
    sections.push(`## Shared Context\n\n${workflowConfig.shared_context}`);
  }

  // 3. Scope context
  if (node.scope) {
    sections.push(`## Your Scope\n\nYou are working on: **${node.scope}**\nRead the relevant files from .caam/shared/ for this scope.`);
  }

  // 4. Signal protocol
  const signalFilename = buildSignalFilename(node);
  sections.push(generateSignalProtocol(node, signalFilename));

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

function generateSignalProtocol(node: DagNode, signalFilename: string): string {
  const agentName = node.name;
  const scope = node.scope ? `"${node.scope}"` : 'null';

  return `## Output Protocol (MANDATORY -- follow exactly)

When you complete your task, follow these steps IN ORDER:

### Step 1: Write output files via temp + rename
For every output file:
\`\`\`bash
cat > .caam/{output_path}.tmp << 'FILEEOF'
{content}
FILEEOF
mv .caam/{output_path}.tmp .caam/{output_path}
\`\`\`

### Step 2: Verify outputs are valid JSON (for .json files)
\`\`\`bash
python3 -c "import json; json.load(open('.caam/{output_path}'))"
\`\`\`

### Step 3: Compute SHA-256 for each output
\`\`\`bash
sha256sum .caam/{output_path} | cut -d' ' -f1
\`\`\`

### Step 4: Write signal file (ALWAYS LAST)
\`\`\`bash
cat > .caam/shared/signals/${signalFilename}.tmp << 'SIGEOF'
{
  "schema_version": 1,
  "signal_id": "sig-{ISO8601compact}-${agentName}-{4hex}",
  "agent": "${agentName}",
  "scope": ${scope},
  "status": "{success|failure|branch|budget_exhausted}",
  "decision": null,
  "outputs": [{fill_with_sha256_and_size}],
  "metrics": {"duration_seconds": {N}, "retries_used": ${node.retryCount}},
  "error": null
}
SIGEOF
mv .caam/shared/signals/${signalFilename}.tmp .caam/shared/signals/${signalFilename}
\`\`\`

CRITICAL RULES:
- NEVER write the signal file before all outputs are written and renamed
- ALWAYS use the .tmp + mv pattern (atomic rename)
- ALWAYS compute sha256 AFTER the mv of the output file
- If you encounter an unrecoverable error, still write a signal with status "failure"`;
}
