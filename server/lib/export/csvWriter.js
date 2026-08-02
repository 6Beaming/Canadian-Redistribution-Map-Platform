const FORMULA_PREFIX = /^[=+\-@\t\r]/u;

export function protectSpreadsheetCell(value) {
  const text = String(value ?? "");
  return FORMULA_PREFIX.test(text) ? `'${text}` : text;
}

export function quoteCsvCell(value) {
  const protectedValue = protectSpreadsheetCell(value);
  return `"${protectedValue.replaceAll('"', '""')}"`;
}

export function writeCsv(columns, rows) {
  const header = columns.map((column) => quoteCsvCell(column.label)).join(",");
  const body = rows.map((row) =>
    columns.map((column) => quoteCsvCell(column.value(row))).join(","));
  return `\uFEFF${[header, ...body].join("\r\n")}\r\n`;
}
