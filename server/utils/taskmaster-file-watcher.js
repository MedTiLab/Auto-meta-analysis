import path from 'path';

const PIPELINE_TASKS_PARTS = ['.pipeline', 'tasks', 'tasks.json'];

export function isPipelineTasksFile(filePath) {
    if (!filePath) {
        return false;
    }

    const parts = path.normalize(String(filePath)).split(path.sep).filter(Boolean);
    if (parts.length < PIPELINE_TASKS_PARTS.length) {
        return false;
    }

    const tail = parts.slice(-PIPELINE_TASKS_PARTS.length);
    return tail.every((part, index) => part === PIPELINE_TASKS_PARTS[index]);
}

export function getProjectPathFromTasksFile(filePath) {
    if (!isPipelineTasksFile(filePath)) {
        return null;
    }

    return path.resolve(path.dirname(String(filePath)), '..', '..');
}

export function normalizeComparablePath(targetPath) {
    if (!targetPath) {
        return null;
    }

    return path.resolve(String(targetPath)).replace(/[\\/]+$/, '');
}

export function resolveProjectNameFromConfig(projectPath, config = {}, encodeProjectPath) {
    const normalizedProjectPath = normalizeComparablePath(projectPath);
    if (!normalizedProjectPath) {
        return null;
    }

    for (const [projectName, projectInfo] of Object.entries(config || {})) {
        if (!projectInfo || typeof projectInfo !== 'object') {
            continue;
        }

        const candidatePaths = [
            projectInfo.originalPath,
            projectInfo.path,
            projectInfo.projectPath,
            projectInfo.metadata?.projectPath,
        ];

        if (candidatePaths.some((candidate) => normalizeComparablePath(candidate) === normalizedProjectPath)) {
            return projectName;
        }
    }

    if (typeof encodeProjectPath === 'function') {
        return encodeProjectPath(normalizedProjectPath);
    }

    return normalizedProjectPath.replace(/[\\/:\s~_.]/g, '-');
}

export async function createTaskMasterTasksFileWatcher({
    chokidar,
    watchRoots,
    watchTargets,
    resolveProjectName,
    onTasksFileChanged,
    logger = console,
    debounceMs = 500,
    watchOptions = {},
}) {
    const targets = Array.isArray(watchTargets) ? watchTargets : watchRoots;
    if (!chokidar?.watch || !Array.isArray(targets) || targets.length === 0) {
        return null;
    }
    if (typeof resolveProjectName !== 'function' || typeof onTasksFileChanged !== 'function') {
        throw new Error('TaskMaster tasks watcher requires resolveProjectName and onTasksFileChanged callbacks');
    }

    const normalizedRoots = Array.from(new Set(
        targets
            .map((root) => normalizeComparablePath(root))
            .filter(Boolean)
    ));

    if (normalizedRoots.length === 0) {
        return null;
    }

    const pendingTimers = new Map();

    const handleFsEvent = (eventType, filePath) => {
        if (!isPipelineTasksFile(filePath)) {
            return;
        }

        const normalizedFilePath = path.resolve(String(filePath));
        const existingTimer = pendingTimers.get(normalizedFilePath);
        if (existingTimer) {
            clearTimeout(existingTimer);
        }

        pendingTimers.set(normalizedFilePath, setTimeout(async () => {
            pendingTimers.delete(normalizedFilePath);

            try {
                const projectPath = getProjectPathFromTasksFile(normalizedFilePath);
                const projectName = await resolveProjectName(normalizedFilePath, projectPath);
                if (!projectName || !projectPath) {
                    logger.warn?.('[TaskMaster watcher] Could not resolve project for tasks file:', normalizedFilePath);
                    return;
                }

                await onTasksFileChanged({
                    eventType,
                    filePath: normalizedFilePath,
                    projectName,
                    projectPath,
                });
            } catch (error) {
                logger.warn?.('[TaskMaster watcher] Failed to handle tasks file change:', error?.message || error);
            }
        }, debounceMs));
    };

    const watcher = chokidar.watch(normalizedRoots, {
        persistent: true,
        ignoreInitial: true,
        followSymlinks: false,
        awaitWriteFinish: {
            stabilityThreshold: 100,
            pollInterval: 50,
        },
        ...watchOptions,
    });

    watcher
        .on('add', (filePath) => handleFsEvent('add', filePath))
        .on('change', (filePath) => handleFsEvent('change', filePath))
        .on('unlink', (filePath) => handleFsEvent('unlink', filePath))
        .on('error', (error) => {
            logger.error?.('[TaskMaster watcher] Watcher error:', error);
        });

    return {
        watcher,
        add(rootPath) {
            const normalizedRoot = normalizeComparablePath(rootPath);
            if (normalizedRoot) {
                watcher.add(normalizedRoot);
            }
        },
        async close() {
            for (const timer of pendingTimers.values()) {
                clearTimeout(timer);
            }
            pendingTimers.clear();
            await watcher.close();
        },
    };
}
