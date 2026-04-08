import type { DagNode, WorkflowConfig } from './types.js';
import type { Hypothesis } from './hypothesis-types.js';
import type { DataManifest } from './manifest-types.js';
import { buildSignalFilename } from './utils.js';
import { extractVariableRefs } from './hypothesis-validator.js';

export function generatePurpose(
  node: DagNode,
  workflowConfig: WorkflowConfig,
  presetContent: string,
  testBudgetInfo?: { tests_executed: number; tests_remaining: number; significance_threshold_current: number },
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

  // 6. Test budget
  if (testBudgetInfo) {
    sections.push([
      `## Test Budget`,
      `Tests executed so far: ${testBudgetInfo.tests_executed}`,
      `Tests remaining: ${testBudgetInfo.tests_remaining}`,
      `Current significance threshold (BH-adjusted): ${testBudgetInfo.significance_threshold_current}`,
      `\nIf tests_remaining is 0, write a signal with status "budget_exhausted".`,
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

// --- Manifest slicing for context window management ---

export function manifestSlice(
  agentName: string,
  hypothesis: Hypothesis | null,
  manifest: DataManifest,
): string {
  // Full manifest agents
  if (['hypothesist', 'adversary', 'generalizer', 'meta_analyst'].includes(agentName)) {
    return JSON.stringify(manifest, null, 2);
  }

  // Executor needs no manifest
  if (agentName === 'executor') {
    return '';
  }

  // Judge gets summary only
  if (agentName === 'judge') {
    return summarizeManifest(manifest);
  }

  // Hypothesis-scoped agents get filtered columns
  if (hypothesis) {
    const varNames = new Set(extractVariableRefs(hypothesis).map(r => r.name));
    for (const c of hypothesis.confounders) varNames.add(c);
    const filtered: DataManifest = {
      ...manifest,
      columns: manifest.columns.filter(c => varNames.has(c.name)),
      correlations: manifest.correlations.filter(c => varNames.has(c.x) || varNames.has(c.y)),
    };
    return JSON.stringify(filtered, null, 2);
  }

  return summarizeManifest(manifest);
}

export function summarizeManifest(manifest: DataManifest): string {
  return [
    `Dataset: ${manifest.metadata.source_file}`,
    `Rows: ${manifest.metadata.row_count}, Columns: ${manifest.metadata.column_count}`,
    `Time series: ${manifest.metadata.is_time_series ? 'Yes (' + manifest.metadata.time_frequency + ')' : 'No'}`,
    `Columns: ${manifest.columns.map(c => c.name + ' (' + c.semantic_type + ')').join(', ')}`,
    `Quality score: ${manifest.quality.overall_score}/100`,
    `Top correlations: ${manifest.correlations.slice(0, 5).map(c => c.x + '<->' + c.y + ' r=' + c.abs_value.toFixed(2)).join(', ')}`,
  ].join('\n');
}
