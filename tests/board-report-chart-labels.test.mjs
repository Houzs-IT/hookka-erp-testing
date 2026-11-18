// Board Report chart amounts. Owner 2026-11-18 「数字都没有给」, then 「有点丑 …
// 美国大型公司 reporting」: amounts are SELECTIVE and sit outside the bar end in ink.
// Rendered to static markup and read back.
import test from "node:test";
import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

globalThis.React = React;
const { ComboChart } = await import("../src/pages/board-report/charts.tsx");

const texts = (html) => [...html.matchAll(/<text[^>]*>([^<]*)<\/text>/g)].map((m) => m[1]);
const render = (props) => renderToStaticMarkup(React.createElement(ComboChart, { w: 700, h: 300, ...props }));
const rev = [
  { key: "r", label: "Revenue", color: "#13294B", type: "bar" },
  { key: "f", label: "Forecast", color: "#B7862C", type: "line", dashed: true },
];

test("one bar series: each cap carries its amount; the dashed forecast line carries none", () => {
  const t = texts(render({ series: rev, data: [{ label: "Sep 26", values: { r: 37_143_000, f: 41_300_000 } }] }));
  assert.ok(t.includes("371k"));
  assert.ok(!t.includes("413k"));
});

test("side-by-side bar series: no bar amounts, the solid Net line is labelled instead", () => {
  const t = texts(render({
    data: [{ label: "Jul 26", values: { o: 4_300_000, f: 9_500_000, n: 12_800_000 } }],
    series: [
      { key: "o", label: "Operating", color: "#13294B", type: "bar" },
      { key: "f", label: "Financing", color: "#8A8F98", type: "bar" },
      { key: "n", label: "Net", color: "#1B7F5A", type: "line" },
    ],
  }));
  assert.ok(t.includes("128k"));
  assert.ok(!t.includes("43k") && !t.includes("95k"));
});

test("a stack prints only its total; labels={false} prints no amounts; labels forces grouped amounts", () => {
  const series = [
    { key: "b", label: "Bedframe", color: "#13294B", type: "bar", stack: "p" },
    { key: "s", label: "Sofa", color: "#B7862C", type: "bar", stack: "p" },
  ];
  const data = [{ label: "Oct 26", values: { b: 25_500_000, s: 16_200_000 } }];
  const t = texts(render({ data, series }));
  assert.ok(t.includes("417k") && !t.includes("255k"));
  assert.ok(!texts(render({ data, series, labels: false })).includes("417k"));
  const g = texts(render({ labels: true, data: [{ label: "Nov", values: { a: 60_000_000, b: 19_200_000 } }], series: [
    { key: "a", label: "Revenue forecast", color: "#13294B", type: "bar" },
    { key: "b", label: "Gross profit forecast", color: "#1B7F5A", type: "bar" },
  ] }));
  assert.ok(g.includes("192k"));
});
