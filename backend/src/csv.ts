/**
 * Convert tabular values into a spreadsheet-safe CSV document.
 *
 * Prefixing formula-like string values prevents spreadsheet applications from
 * interpreting exported operator-controlled text as a formula when opened.
 */
export function toCsv(rows: Array<Record<string, unknown>>) {
  if (!rows.length) return "";
  const headers = Object.keys(rows[0]);
  const cell = (value: unknown) => {
    const text = String(value ?? "");
    const safe =
      typeof value === "string" && /^[=+\-@\t\r]/.test(text)
        ? `'${text}`
        : text;
    return `"${safe.replaceAll('"', '""')}"`;
  };
  return [
    headers.map(cell).join(","),
    ...rows.map((row) => headers.map((header) => cell(row[header])).join(",")),
  ].join("\r\n");
}
