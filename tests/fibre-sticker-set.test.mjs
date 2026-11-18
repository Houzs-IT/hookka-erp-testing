import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  buildFallbackPackingHeader,
  isOrderInFibreStickerScope,
  numberWithinSalesOrder,
  pickPackingHeaderForPo,
} from '../src/pages/production/fibre-sticker-set.ts';

test('numbersCushionsAcrossTheSameSalesOrder', () => {
  const positions = numberWithinSalesOrder([
    { poNo: 'CO-2610-012-01', salesOrderNo: 'CO-2610-012' },
    { poNo: 'CO-2610-012-02', salesOrderNo: 'CO-2610-012' },
    { poNo: 'SO-2611-001-01', salesOrderNo: 'SO-2611-001' },
  ]);
  assert.deepEqual(positions, [
    { position: 1, setSize: 2 },
    { position: 2, setSize: 2 },
    { position: 1, setSize: 1 },
  ]);
});

test('numbersByPoWhenSalesOrderIsMissing', () => {
  const positions = numberWithinSalesOrder([{ poNo: 'PO-1' }, { poNo: 'PO-1' }]);
  assert.deepEqual(positions, [
    { position: 1, setSize: 2 },
    { position: 2, setSize: 2 },
  ]);
});

test('picksTheRealPackingHeaderNotASyntheticLegOrPillow', () => {
  const headers = [
    { poNo: 'CO-2610-012-01', isSyntheticLegs: true, productCode: 'LEG' },
    { poNo: 'CO-2610-012-01', productCode: '5531-L(LHF)', boxLabel: '5531-L(LHF)+2A(RHF)' },
  ];
  assert.equal(pickPackingHeaderForPo(headers, 'CO-2610-012-01')?.productCode, '5531-L(LHF)');
  assert.equal(pickPackingHeaderForPo(headers, 'OTHER'), undefined);
});

test('fallbackHeaderUsesTheFibreJobCardDetails', () => {
  const header = buildFallbackPackingHeader({
    poNo: 'CO-2610-012-01',
    customerName: '2990 HOME SDN BHD',
    salesOrderNo: 'CO-2610-012',
    model: '5531',
    wipName: 'Back cushion',
    sizeLabel: '28',
    colour: 'BROWNIE-01',
  });
  assert.equal(header.customerName, '2990 HOME SDN BHD');
  assert.equal(header.productCode, '5531');
  assert.equal(header.boxLabel, 'Back cushion');
  assert.equal(header.fabricCode, 'BROWNIE-01');
});

test('scopeAddsSofaSiblingLinesButNotBedframeSiblings', () => {
  const fibrePoNos = new Set(['CO-2610-012-01']);
  const fibreSalesOrderNos = new Set(['CO-2610-012']);
  const inScope = (order) => isOrderInFibreStickerScope(order, fibrePoNos, fibreSalesOrderNos);
  assert.equal(inScope({ poNo: 'CO-2610-012-01', itemCategory: 'SOFA' }), true);
  assert.equal(inScope({ poNo: 'CO-2610-012-02', itemCategory: 'SOFA', companyCOId: 'CO-2610-012' }), true);
  assert.equal(inScope({ poNo: 'CO-2610-012-03', itemCategory: 'BEDFRAME', companyCOId: 'CO-2610-012' }), false);
  assert.equal(inScope({ poNo: 'SO-9999-001-01', itemCategory: 'SOFA', companySOId: 'SO-9999-001' }), false);
});

test('fibrePrintAllUsesTheFibreStickerAndOtherTabsKeepTheirs', () => {
  const source = readFileSync(resolve(process.cwd(), 'src/pages/production/index.tsx'), 'utf8');
  assert.match(source, /onClick=\{activeTab === "FIBRE" \? handlePrintFibreStickers : handlePrintJobCardStickers\}/);
  assert.match(source, /jobCardStickers\.map\(\(s\) => s\.fibre \? \(\s*<FibreStickerPage/);
  assert.doesNotMatch(source, /Print Packing Stickers[\s\S]{0,200}FIBRE/);
});
