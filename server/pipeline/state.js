import path from 'path';
import { promises as fs } from 'fs';

function getPipelinePaths(projectPath) {
  return {
    researchBriefFile: path.join(projectPath, '.pipeline', 'docs', 'research_brief.json'),
    tasksFile: path.join(projectPath, '.pipeline', 'tasks', 'tasks.json'),
  };
}

function extractTasksFromData(tasksData) {
  let currentTag = 'master';
  let tasks = [];

  if (Array.isArray(tasksData)) {
    tasks = tasksData;
  } else if (tasksData?.tasks) {
    tasks = tasksData.tasks;
  } else if (tasksData && typeof tasksData === 'object') {
    if (tasksData[currentTag]?.tasks) {
      tasks = tasksData[currentTag].tasks;
    } else {
      const firstTag = Object.keys(tasksData).find((key) => Array.isArray(tasksData[key]?.tasks));
      if (firstTag) {
        currentTag = firstTag;
        tasks = tasksData[firstTag].tasks;
      }
    }
  }

  return { currentTag, tasks: Array.isArray(tasks) ? tasks : [] };
}

function normalizeTaskStatus(status) {
  const raw = String(status || '').trim().toLowerCase();
  if (!raw) return 'pending';
  if (raw === 'completed' || raw === 'complete') return 'done';
  if (raw === 'in_progress' || raw === 'inprogress') return 'in-progress';
  if (raw === 'todo' || raw === 'open') return 'pending';
  return raw;
}

function normalizeTaskStage(stage) {
  const raw = String(stage || '').trim().toLowerCase();
  if (raw === 'presentation') return 'promotion';
  if (raw === 'research' || raw === 'survey') return 'literature';
  return raw;
}

function normalizeTask(task) {
  return {
    id: task.id,
    title: task.title || 'Untitled Task',
    status: normalizeTaskStatus(task.status),
    stage: normalizeTaskStage(task.stage),
    nextActionPrompt: typeof task.nextActionPrompt === 'string' ? task.nextActionPrompt : '',
  };
}

async function readJsonIfExists(filePath) {
  try {
    const raw = await fs.readFile(filePath, 'utf8');
    return {
      exists: true,
      valid: true,
      data: JSON.parse(raw),
      error: null,
    };
  } catch (error) {
    if (error?.code === 'ENOENT') {
      return {
        exists: false,
        valid: false,
        data: null,
        error: null,
      };
    }

    return {
      exists: true,
      valid: false,
      data: null,
      error: error.message,
    };
  }
}

async function readPipelineState(projectPath) {
  const paths = getPipelinePaths(projectPath);
  const [researchBriefResult, tasksResult] = await Promise.all([
    readJsonIfExists(paths.researchBriefFile),
    readJsonIfExists(paths.tasksFile),
  ]);

  const tasks = tasksResult.valid
    ? extractTasksFromData(tasksResult.data).tasks.map(normalizeTask)
    : [];

  const actionableTasks = tasks.filter((task) => (
    task.status === 'pending'
    || task.status === 'in-progress'
    || task.status === 'review'
  ));
  const nextTask = tasks.find((task) => task.status === 'in-progress')
    || tasks.find((task) => task.status === 'review')
    || tasks.find((task) => task.status === 'pending')
    || null;

  return {
    ...paths,
    hasResearchBrief: researchBriefResult.exists,
    researchBriefValid: researchBriefResult.exists ? researchBriefResult.valid : false,
    researchBriefError: researchBriefResult.error,
    researchBriefData: researchBriefResult.valid ? researchBriefResult.data : null,
    hasTasksFile: tasksResult.exists,
    tasksValid: tasksResult.exists ? tasksResult.valid : false,
    tasksError: tasksResult.error,
    tasks,
    nextTask,
    actionableTaskCount: actionableTasks.length,
    completedTaskCount: tasks.filter((task) => task.status === 'done').length,
  };
}

export {
  extractTasksFromData,
  getPipelinePaths,
  normalizeTask,
  normalizeTaskStage,
  normalizeTaskStatus,
  readPipelineState,
};
