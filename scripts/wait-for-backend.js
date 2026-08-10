#!/usr/bin/env node

import '../server/load-env.js';
import {
  DEFAULT_BACKEND_PORT,
  getBackendPortSync,
  parsePortNumber,
} from '../server/utils/runtimePorts.js';

const REQUEST_TIMEOUT_MS = 1000;
const POLL_INTERVAL_MS = 250;
const DEFAULT_TIMEOUT_MS = 30000;

const timeoutMs = parsePortNumber(
  process.env.MEDAUTODATA_BACKEND_WAIT_TIMEOUT_MS,
  DEFAULT_TIMEOUT_MS,
);
const fallbackPort = parsePortNumber(process.env.PORT, DEFAULT_BACKEND_PORT);
const host = process.env.HOST && process.env.HOST !== '0.0.0.0'
  ? process.env.HOST
  : 'localhost';
const deadline = Date.now() + timeoutMs;

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function isBackendReady() {
  const port = getBackendPortSync(fallbackPort);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(`http://${host}:${port}/health`, {
      signal: controller.signal,
      cache: 'no-store',
    });
    return response.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timeout);
  }
}

process.stdout.write('[wait-for-backend] Waiting for backend');

while (Date.now() < deadline) {
  if (await isBackendReady()) {
    process.stdout.write('\n[wait-for-backend] Backend ready\n');
    process.exit(0);
  }

  process.stdout.write('.');
  await sleep(POLL_INTERVAL_MS);
}

process.stdout.write('\n');
console.error(`[wait-for-backend] Backend did not become ready within ${timeoutMs}ms`);
process.exit(1);
