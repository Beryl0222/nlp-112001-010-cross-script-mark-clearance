import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readMaterials } from '../materials.js';
import { Taxonomy } from '../lib/taxonomy.js';
import { conceptRelation } from '../lib/terminology.js';

let taxonomy;
test.before(async () => {
  taxonomy = Taxonomy.fromTables(await readMaterials());
});

test('概念上下位：滴灌接头属于配件/园艺器具，套管属于工业流体配件', () => {
  assert.equal(conceptRelation('DRIP_FITTINGS', 'PARTS').relation, 'narrower');
  assert.equal(conceptRelation('DRIP_FITTINGS', 'IRRIGATION_EQUIPMENT').relation, 'narrower');
  assert.equal(conceptRelation('TUBING', 'FLUID_PARTS').relation, 'narrower');
  assert.equal(conceptRelation('LANDSCAPE', 'DESIGN_SERVICE').relation, 'narrower');
  assert.equal(conceptRelation('TUBING', 'LANDSCAPE').relation, 'none');
});

test('笼统的“零件/配件”按上位概念可与 H-12 形成上下位对应（需人工确认）', () => {
  const r = taxonomy.assessGoods(
    [{ text: '零件', conceptId: 'PARTS' }], 'H-12', '海港区',
  );
  assert.equal(r.related, true);
  assert.ok(['broader', 'same'].includes(r.relation));
  assert.match(r.reason, /下位|同一/);
});

test('S-71 修订历史可按编号取 rev1/rev2，当前版本为 rev2', () => {
  assert.equal(taxonomy.row('S-71', '1').text, '仅供工业流体传输');
  assert.match(taxonomy.row('S-71', '2').text, /商业园艺滴灌/);
  assert.equal(taxonomy.current('S-71', '松岛').revision, '2');
});

test('同一编号在不同市场隔离；缺类目给 unknown 而不是乱判', () => {
  assert.equal(taxonomy.current('H-12', '松岛'), null);
  const r = taxonomy.assessGoods([{ text: 'x', conceptId: 'PARTS' }], 'NO-SUCH', '月球');
  assert.equal(r.related, false);
  assert.match(r.reason, /缺少/);
});
