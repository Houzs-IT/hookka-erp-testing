import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const source = readFileSync(resolve(process.cwd(), 'src/pages/production/index.tsx'), 'utf8');

function readPrePrintDepartments() {
  const match = source.match(/const PACKING_PREPRINT_DEPTS = new Set<string>\(\[([^\]]*)\]\)/);
  assert.ok(match, 'PACKING_PREPRINT_DEPTS is missing from production/index.tsx');
  return match[1].split(',').map((entry) => entry.trim().replace(/"/g, ''));
}

test('fibreAndFoamTabsCanPrePrintPackingStickers', () => {
  assert.deepEqual(readPrePrintDepartments().sort(), ['FIBRE', 'FOAM']);
});

test('packingButtonsAndPreviewAreGatedOnTheSharedDepartmentSet', () => {
  assert.match(source, /\{canPrePrintPacking && \(\(\) => \{\s*const hasTopSearch/);
  assert.match(source, /\{canPrePrintPacking && showFoamPackingPreview && foamPrintStickers\.length > 0 && \(/);
  assert.doesNotMatch(source, /activeTab === "FOAM" && showFoamPackingPreview/);
});

test('packingToastsNameTheActiveDepartmentNotFoam', () => {
  assert.doesNotMatch(source, /No Foam rows are visible to pack/);
  assert.doesNotMatch(source, /visible Foam rows to any production orders/);
});
