import assert from "node:assert/strict";
import { test } from "@jest/globals";
import { protectSpreadsheetCell, writeCsv } from "../server/lib/export/csvWriter.js";

test("CSV export uses BOM, CRLF, RFC quoting, and formula protection", () => {
  const csv = writeCsv([
    { label: "Name", value: (row) => row.name },
    { label: "Title", value: (row) => row.title },
  ], [{ name: "=cmd", title: "A, \"quoted\" title" }]);
  assert.equal(csv.startsWith("\uFEFF"), true);
  assert.equal(csv.endsWith("\r\n"), true);
  assert.equal(csv.includes("\n") && !csv.replaceAll("\r\n", "").includes("\n"), true);
  assert.equal(csv.includes("\"'=cmd\""), true);
  assert.equal(csv.includes("\"A, \"\"quoted\"\" title\""), true);
  ["=x", "+x", "-x", "@x", "\tx", "\rx"].forEach((value) => {
    assert.equal(protectSpreadsheetCell(value), `'${value}`);
  });
});
