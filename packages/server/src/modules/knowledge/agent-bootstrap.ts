import * as fs from 'node:fs';
import * as path from 'node:path';

const COMMUNICATION_TEMPLATE = `
---

## Communication

To see which agents are available, read:
  .plurics/shared/agents.md

To send a message to another agent, append to:
  .plurics/agents/<target-name>/inbox.md

Use this format:
  ## From: <your-name> @ <timestamp>
  <message body>

Your inbox is at .plurics/agents/<your-name>/inbox.md
Check it when notified.
`;

export class AgentBootstrap {
  private pluricsDir: string | null = null;

  setCwd(cwd: string): void {
    this.pluricsDir = path.join(cwd, '.plurics');
  }

  getPluricsDir(): string | null {
    return this.pluricsDir;
  }

  ensureDirectoryStructure(): void {
    if (!this.pluricsDir) return;
    fs.mkdirSync(path.join(this.pluricsDir, 'shared'), { recursive: true });
    fs.mkdirSync(path.join(this.pluricsDir, 'agents'), { recursive: true });
  }

  createAgentFiles(agentName: string, purpose: string): void {
    if (!this.pluricsDir) return;
    this.ensureDirectoryStructure();

    const agentDir = path.join(this.pluricsDir, 'agents', agentName);
    fs.mkdirSync(agentDir, { recursive: true });

    const fullPurpose = purpose.trim() + '\n' + COMMUNICATION_TEMPLATE;
    fs.writeFileSync(path.join(agentDir, 'purpose.md'), fullPurpose, 'utf-8');

    const inboxPath = path.join(agentDir, 'inbox.md');
    if (!fs.existsSync(inboxPath)) {
      fs.writeFileSync(inboxPath, '', 'utf-8');
    }
  }

  regenerateAgentsList(activeAgents: Array<{ name: string; purpose: string }>): void {
    if (!this.pluricsDir) return;
    this.ensureDirectoryStructure();

    let content = '# Active Agents\n';
    for (const agent of activeAgents) {
      const summary = agent.purpose.split('\n')[0].trim();
      content += `\n## ${agent.name}\n- **Status**: running\n- **Purpose**: ${summary}\n`;
    }

    fs.writeFileSync(path.join(this.pluricsDir, 'shared', 'agents.md'), content, 'utf-8');
  }

  getInjectionPrompt(agentName: string): string {
    return `Read your purpose and instructions at .plurics/agents/${agentName}/purpose.md and follow them.\r`;
  }
}
