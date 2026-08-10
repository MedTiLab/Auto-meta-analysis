import { spawn } from 'child_process';
import { promises as fsPromises } from 'fs';
import path from 'path';

export function runDiagnosticMetaAnalysis({ inputCsvPath, outputDir, scriptPath }) {
  return new Promise((resolve) => {
    const startedAt = new Date().toISOString();
    const args = [scriptPath, '--input', inputCsvPath, '--output', outputDir];
    const child = spawn('Rscript', args, {
      cwd: path.resolve(path.join(path.dirname(scriptPath), '..', '..', '..')),
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });

    child.on('error', async (error) => {
      await fsPromises.mkdir(outputDir, { recursive: true });
      await Promise.all([
        fsPromises.writeFile(path.join(outputDir, 'stdout.log'), stdout, 'utf8'),
        fsPromises.writeFile(path.join(outputDir, 'stderr.log'), `${stderr}${error.message}\n`, 'utf8'),
      ]);
      resolve({
        status: 'failed',
        error: error.message,
        stdout,
        stderr: `${stderr}${error.message}`,
        startedAt,
        finishedAt: new Date().toISOString(),
      });
    });

    child.on('close', async (code) => {
      await fsPromises.mkdir(outputDir, { recursive: true });
      await Promise.all([
        fsPromises.writeFile(path.join(outputDir, 'stdout.log'), stdout, 'utf8'),
        fsPromises.writeFile(path.join(outputDir, 'stderr.log'), stderr, 'utf8'),
      ]);
      resolve({
        status: code === 0 ? 'completed' : 'failed',
        error: code === 0 ? null : `Rscript exited with code ${code}`,
        stdout,
        stderr,
        startedAt,
        finishedAt: new Date().toISOString(),
      });
    });
  });
}
