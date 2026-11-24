import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, rm, readFile, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { runDemo } from '../lib/demo.js';

const execFileAsync = promisify(execFile);
const projectRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const toolJs = join(projectRoot, 'tool.js');

test('runDemo 在空目录生成工作簿、别名库、快照与三类报告，且合并结果完整', async (context) => {
  const root = await mkdtemp(join(tmpdir(), 'clearance-demo-'));
  context.after(() => rm(root, { recursive: true, force: true }));

  const out = await runDemo({ root });

  await access(join(root, '工作', 'workbook.json'));
  await access(join(root, '工作', 'alias-library.json'));
  await access(join(root, '工作', 'snapshots', 'consult-001.json'));
  await access(join(root, '工作', '派单', 'A-001-海港区.json'));
  await access(join(root, '工作', '派单', 'A-002-松岛.json'));
  await access(join(root, '报告', '客户清单-q1.md'));
  await access(join(root, '报告', '顾问底稿-q2.md'));
  await access(join(root, '报告', '总览.md'));

  assert.equal(out.mergeH.ok, true);
  assert.equal(out.mergeS.ok, true);
  assert.equal(out.impacts.length, 1);
  assert.deepEqual(out.abbr.otherClients.sort(), ['河岸园艺', '雨海设计']);
  assert.ok(out.descriptor.retained.length >= 4);

  const wb = JSON.parse(await readFile(join(root, '工作', 'workbook.json'), 'utf8'));
  // 海港区三条 H-12 候选都有各自的当地回复
  const h12 = Object.values(wb.findings).filter(f => f.market === '海港区' && f.trademark.category === 'H-12');
  const merged = h12.filter(f => f.localChecks.length === 1);
  assert.equal(merged.length, 3);
  const notes = new Set(merged.map(f => f.localChecks[0].note));
  assert.equal(notes.size, 3, '三条回复内容必须分别保留');

  const q1 = await readFile(join(root, '报告', '客户清单-q1.md'), 'utf8');
  assert.match(q1, /不构成、也不能代替正式商标注册意见/);
  assert.match(q1, /跨文字音译/);
  assert.match(q1, /S-71/);

  const docket = await readFile(join(root, '报告', '顾问底稿-q1.md'), 'utf8');
  assert.match(docket, /字符区间/);
  assert.match(docket, /decisionHistory|revision-reopen/);
});

test('CLI analyze --json 输出可解析的 q1 结果；help 返回 0', async () => {
  const { stdout } = await execFileAsync(process.execPath, [toolJs, 'analyze', 'q1', '--json'], { cwd: projectRoot });
  const parsed = JSON.parse(stdout);
  assert.equal(parsed.queries.length, 1);
  assert.equal(parsed.queries[0].id, 'q1');
  assert.ok(parsed.findings.some(f => f.trademark.id === 't1' && f.priority === 'P1'));

  const help = await execFileAsync(process.execPath, [toolJs, 'help'], { cwd: projectRoot });
  assert.match(help.stdout, /correct-abbr/);
});

test('CLI text 直接处理题首例句：套管非品牌，雨杉有跨文字命中', async () => {
  const sentence = '雨杉做园艺滴灌配件，也供不带雨杉商标的塑料套管。';
  const { stdout } = await execFileAsync(
    process.execPath, [toolJs, 'text', sentence, '--json'], { cwd: projectRoot },
  );
  const q = JSON.parse(stdout);
  const tube = q.goods.find(g => g.text === '塑料套管');
  assert.equal(tube.brandUse, false);
  assert.ok(q.mentions.some(m => m.text === '雨杉' && m.role === 'actual'));
  assert.ok(q.findings.some(f => f.trademark.id === 't1'
    && f.evidences.some(e => e.code === 'transliteration')));
});
