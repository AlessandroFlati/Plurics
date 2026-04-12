/**
 * Smoke test plugin: pre-loads sentence.txt into the reviewer's purpose.
 */

import type { WorkflowPlugin, PurposeContext, PurposeEnrichment } from '../../packages/server/src/modules/workflow/sdk.js';
import * as path from 'node:path';
import * as fs from 'node:fs/promises';

const plugin: WorkflowPlugin = {
  async onPurposeGenerate(ctx: PurposeContext): Promise<PurposeEnrichment> {
    if (ctx.nodeName === 'reviewer') {
      const workspacePath = path.join(ctx.runDirectory, '..', '..', '..');
      const sentencePath = path.join(workspacePath, '.plurics', 'shared', 'sentence.txt');
      try {
        const sentence = await fs.readFile(sentencePath, 'utf-8');
        return {
          append: `\n\n---\n\n## Sentence to Review\n\n"${sentence.trim()}"\n\nRespond with ONLY "APPROVED" or "REJECTED".`,
        };
      } catch {
        return {
          append: `\n\n---\n\n## Error\n\nCould not load sentence.txt`,
        };
      }
    }
    return {};
  },
};

export default plugin;
