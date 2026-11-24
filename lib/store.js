// 本地 JSON 工作簿/别名库持久化：原子写入，全部数据留在本机 工作/ 目录。

import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import { dirname } from 'node:path';

export async function loadJson(file, fallback = null) {
  try {
    return JSON.parse(await readFile(file, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return fallback;
    throw error;
  }
}

export async function saveJsonAtomic(file, data) {
  await mkdir(dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  await writeFile(tmp, JSON.stringify(data, null, 2) + '\n', 'utf8');
  await rename(tmp, file);
}

export function newWorkbook({ now = new Date().toISOString(), materialsCounts = null } = {}) {
  return {
    schemaVersion: 1,
    createdAt: now,
    updatedAt: now,
    materialsCounts,
    findings: {},
    assignments: [],
    events: [],
  };
}

export function newAliasLibrary({ now = new Date().toISOString() } = {}) {
  return { schemaVersion: 1, createdAt: now, updatedAt: now, links: [], corrections: [] };
}
