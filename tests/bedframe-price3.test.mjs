import test from "node:test";
import assert from "node:assert/strict";
import { bedframePrice3Sen } from "../src/lib/utils.ts";

test("price 3 is price 2 plus 10 percent, in whole sen", () => {
  assert.equal(bedframePrice3Sen(71000), 78100);
  assert.equal(bedframePrice3Sen(58500), 64350);
  assert.equal(bedframePrice3Sen(51500), 56650);
});

test("price 3 rounds half a sen up to 2 decimals", () => {
  assert.equal(bedframePrice3Sen(12345), 13580);
  assert.equal(bedframePrice3Sen(5), 6);
  assert.equal(bedframePrice3Sen(4), 4);
});

test("price 3 is empty when there is no price 2", () => {
  assert.equal(bedframePrice3Sen(null), null);
  assert.equal(bedframePrice3Sen(undefined), null);
  assert.equal(bedframePrice3Sen(0), null);
});
