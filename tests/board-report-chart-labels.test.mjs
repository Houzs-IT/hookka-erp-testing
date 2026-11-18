// Owner 2026-11-18 「bar chart 数字都没有给」: every Board Report bar and line point
// carries its amount. Rendered to static markup and read back.
import test from "node:test";
import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

globalThis.React = React;
const { ComboChart } = await import("../src/pages/board-report/charts.tsx");

const texts = (html) => [...html.matchAll(/<text[^>]*>([^<]*)<\/text>/g)].map((m) => m[1]);
const render = (props) => renderToStaticMarkup(React.createElement(ComboChart, { w: 700, h: 300, ...props }));

test("bars and line points print their amounts; a line point equal to its bar is not printed twice", () => {
  const html = render({
    data: [
      { label: "Sep 26", values: { r: 37_143_000, f: 40_000_000 } },
      { label: "Nov 26 F", faded: true, values: { r: 60_000_000, f: 60_000_000 } },
    ],
    series: [
      { key: "r", label: "Revenue", color: "#13294B", type: "bar" },
      { key: "f", label: "Forecast", color: "#B7862C", type: "line", dashed: true },
    ],
  });
  const t = texts(html);
  assert.ok(t.includes("371k"), "bar amount");
  assert.ok(t.includes("400k"), "line point amount");
  assert.equal(t.filter((x) => x === "600k").length, 2, "600k once as the bar label + once as the y-axis tick — not again for the line point");
});

test("a stack prints its total above it; labels={false} prints no amounts", () => {
  const series = [
    { key: "b", label: "Bedframe", color: "#13294B", type: "bar", stack: "p" },
    { key: "s", label: "Sofa", color: "#B7862C", type: "bar", stack: "p" },
  ];
  const data = [{ label: "Oct 26", values: { b: 25_500_000, s: 16_200_000 } }];
  assert.ok(texts(render({ data, series })).includes("417k"));
  assert.ok(!texts(render({ data, series, labels: false })).includes("417k"));
});
