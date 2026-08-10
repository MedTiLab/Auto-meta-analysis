#!/usr/bin/env node

import path from 'path';

import { syncTasksWithResearchBrief, updateTaskRecord } from '../server/routes/taskmaster.js';

function printUsage() {
  console.log(`Usage:
  node scripts/pipeline-task.mjs update --task-id <id> [--project-path <abs-path>] [--status <status>] [--details <text>] [--title <text>] [--description <text>] [--priority <low|medium|high>]
  node scripts/pipeline-task.mjs sync-from-brief [--project-path <abs-path>] [--file-name research_brief.json] [--mode merge|replace|append] [--num-tasks <n>]
`);
}

function parseArgs(argv = []) {
  const [command, ...rest] = argv;
  const args = { _: [] };
  for (let index = 0; index < rest.length; index += 1) {
    const token = rest[index];
    if (!token.startsWith('--')) {
      args._.push(token);
      continue;
    }
    const key = token.slice(2);
    const next = rest[index + 1];
    if (next && !next.startsWith('--')) {
      args[key] = next;
      index += 1;
    } else {
      args[key] = true;
    }
  }
  return { command, args };
}

async function main() {
  const { command, args } = parseArgs(process.argv.slice(2));
  const projectPath = path.resolve(String(args['project-path'] || process.cwd()));

  if (!command || args.help || args.h) {
    printUsage();
    process.exit(command ? 0 : 1);
  }

  if (command === 'update') {
    if (!args['task-id']) {
      throw new Error('--task-id is required for update');
    }
    const result = await updateTaskRecord(projectPath, args['task-id'], {
      status: args.status,
      details: args.details,
      title: args.title,
      description: args.description,
      priority: args.priority,
    });
    console.log(JSON.stringify({
      success: true,
      command,
      projectPath,
      task: result.task,
      timestamp: result.timestamp,
    }, null, 2));
    return;
  }

  if (command === 'sync-from-brief') {
    const result = await syncTasksWithResearchBrief(projectPath, {
      fileName: args['file-name'] || 'research_brief.json',
      mode: args.mode || 'merge',
      numTasks: args['num-tasks'] ? Number(args['num-tasks']) : undefined,
    });
    console.log(JSON.stringify({
      success: true,
      command,
      projectPath,
      ...result,
    }, null, 2));
    return;
  }

  throw new Error(`Unknown command: ${command}`);
}

main().catch((error) => {
  console.error(error.message || String(error));
  process.exit(1);
});
