import path from 'path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  createTaskMasterTasksFileWatcher,
  getProjectPathFromTasksFile,
  isPipelineTasksFile,
  resolveProjectNameFromConfig,
} from '../utils/taskmaster-file-watcher.js';

afterEach(() => {
  vi.useRealTimers();
});

function createFakeChokidar() {
  const handlers = new Map();
  const watcher = {
    on: vi.fn((eventName, handler) => {
      handlers.set(eventName, handler);
      return watcher;
    }),
    add: vi.fn(),
    close: vi.fn(async () => {}),
  };

  return {
    chokidar: {
      watch: vi.fn(() => watcher),
    },
    handlers,
    watcher,
  };
}

describe('TaskMaster tasks file watcher', () => {
  it('recognizes pipeline task files and resolves the project root', () => {
    const tasksPath = path.join('/tmp', 'meta-project', '.pipeline', 'tasks', 'tasks.json');

    expect(isPipelineTasksFile(tasksPath)).toBe(true);
    expect(isPipelineTasksFile(path.join('/tmp', 'meta-project', '.pipeline', 'docs', 'research_brief.json'))).toBe(false);
    expect(getProjectPathFromTasksFile(tasksPath)).toBe(path.join('/tmp', 'meta-project'));
  });

  it('maps a task file project path back to configured project names', () => {
    const projectPath = path.join('/tmp', 'projects', 'meta review');
    const config = {
      configuredProjectId: {
        originalPath: projectPath,
      },
    };

    expect(resolveProjectNameFromConfig(projectPath, config, () => 'fallback-id')).toBe('configuredProjectId');
    expect(resolveProjectNameFromConfig(path.join('/tmp', 'other'), config, () => 'fallback-id')).toBe('fallback-id');
  });

  it('debounces task file changes and emits resolved project metadata', async () => {
    vi.useFakeTimers();
    const { chokidar, handlers } = createFakeChokidar();
    const onTasksFileChanged = vi.fn(async () => {});
    const tasksPath = path.join('/tmp', 'meta-project', '.pipeline', 'tasks', 'tasks.json');

    await createTaskMasterTasksFileWatcher({
      chokidar,
      watchRoots: [path.join('/tmp', 'meta-project')],
      resolveProjectName: async () => 'project-id',
      onTasksFileChanged,
      debounceMs: 25,
      logger: { warn: vi.fn(), error: vi.fn() },
    });

    handlers.get('change')(tasksPath);
    handlers.get('change')(tasksPath);
    handlers.get('change')(path.join('/tmp', 'meta-project', '.pipeline', 'docs', 'research_brief.json'));

    await vi.advanceTimersByTimeAsync(25);

    expect(onTasksFileChanged).toHaveBeenCalledTimes(1);
    expect(onTasksFileChanged).toHaveBeenCalledWith({
      eventType: 'change',
      filePath: tasksPath,
      projectName: 'project-id',
      projectPath: path.join('/tmp', 'meta-project'),
    });
  });
});
