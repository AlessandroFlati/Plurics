import * as fs from 'node:fs';
import * as path from 'node:path';

const COMMUNICATION_TEMPLATE = `
---

## Communication

To see which agents are available, read:
  .caam/shared/agents.md

To send a message to another agent, append to:
  .caam/agents/<target-name>/inbox.md

Use this format:
  ## From: <your-name> @ <timestamp>
  <message body>

Your inbox is at .caam/agents/<your-name>/inbox.md
Check it when notified.
`;

export class AgentBootstrap {
  private caamDir: string | null = null;

  setCwd(cwd: string): void {
    this.caamDir = path.join(cwd, '.caam');
  }

  getCaamDir(): string | null {
    return this.caamDir;
  }

  ensureDirectoryStructure(): void {
    if (!this.caamDir) return;
    fs.mkdirSync(path.join(this.caamDir, 'shared'), { recursive: true });
    fs.mkdirSync(path.join(this.caamDir, 'agents'), { recursive: true });
  }

  createAgentFiles(agentName: string, purpose: string): void {
    if (!this.caamDir) return;
    this.ensureDirectoryStructure();

    const agentDir = path.join(this.caamDir, 'agents', agentName);
    fs.mkdirSync(agentDir, { recursive: true });

    const fullPurpose = purpose.trim() + '\n' + COMMUNICATION_TEMPLATE;
    fs.writeFileSync(path.join(agentDir, 'purpose.md'), fullPurpose, 'utf-8');

    const inboxPath = path.join(agentDir, 'inbox.md');
    if (!fs.existsSync(inboxPath)) {
      fs.writeFileSync(inboxPath, '', 'utf-8');
    }
  }

  regenerateAgentsList(activeAgents: Array<{ name: string; purpose: string }>): void {
    if (!this.caamDir) return;
    this.ensureDirectoryStructure();

    let content = '# Active Agents\n';
    for (const agent of activeAgents) {
      const summary = agent.purpose.split('\n')[0].trim();
      content += `\n## ${agent.name}\n- **Status**: running\n- **Purpose**: ${summary}\n`;
    }

    fs.writeFileSync(path.join(this.caamDir, 'shared', 'agents.md'), content, 'utf-8');
  }

  getInjectionPrompt(agentName: string): string {
    return `Read your purpose and instructions at .caam/agents/${agentName}/purpose.md and follow them.\r`;
  }
}
