/**
 * Smoke test plugin: pre-loads sentence.txt into the reviewer's purpose.
 */

import type { WorkflowPlugin, PurposeContext } from '../../packages/server/src/modules/workflow/sdk.js';
import * as path from 'node:path';
import * as fs from 'node:fs/promises';

const plugin: WorkflowPlugin = {
  async onPurposeGenerate(nodeName, basePurpose, context: PurposeContext): Promise<string> {
    if (nodeName === 'reviewer') {
      const sentencePath = path.join(context.workspacePath, '.plurics', 'shared', 'sentence.txt');
      try {
        const sentence = await fs.readFile(sentencePath, 'utf-8');
        return `${basePurpose}\n\n---\n\n## Sentence to Review\n\n"${sentence.trim()}"\n\nRespond with ONLY "APPROVED" or "REJECTED".`;
      } catch {
        return `${basePurpose}\n\n---\n\n## Error\n\nCould not load sentence.txt`;
      }
    }
    return basePurpose;
  },
};

export default plugin;
