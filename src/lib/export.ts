// Export helpers — Excel (CSV) and PDF (print) dökümleri.

export const formatDate = (ts: number): string =>
  new Intl.DateTimeFormat("tr-TR", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(ts);

export const formatNumber = (value: number): string =>
  new Intl.NumberFormat("tr-TR", { maximumFractionDigits: 2 }).format(value);

export const formatCurrency = (value: number): string =>
  new Intl.NumberFormat("tr-TR", {
    style: "currency",
    currency: "TRY",
    maximumFractionDigits: 2,
  }).format(value);

/** Parse a numeric input that may use a Turkish decimal comma. */
export const parseNumber = (value: string): number | undefined => {
  if (value.trim() === "") return undefined;
  const parsed = Number(value.replace(/\./g, "").replace(",", "."));
  return Number.isFinite(parsed) ? parsed : undefined;
};

/** Convert a timestamp to a local date-input value (yyyy-MM-dd). */
export const dateToInput = (ts: number): string => {
  const d = new Date(ts);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};

/** Convert a date-input value to a timestamp at local midnight. */
export const parseDateInput = (value: string): number | undefined => {
  if (!value) return undefined;
  const ts = new Date(`${value}T00:00:00`).getTime();
  return Number.isFinite(ts) ? ts : undefined;
};

const dateStamp = () => {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};

/**
 * Download rows as an Excel-friendly CSV (UTF-8 BOM, ";" separated).
 * Turkish Excel opens `;`-separated CSV without configuration.
 */
export function downloadCsv(
  filename: string,
  headers: string[],
  rows: (string | number | null | undefined)[][],
) {
  const escape = (value: string | number | null | undefined) =>
    `"${String(value ?? "").replace(/"/g, '""')}"`;

  const lines = [
    headers.map(escape).join(";"),
    ...rows.map((row) => row.map(escape).join(";")),
  ];

  const blob = new Blob(["\uFEFF" + lines.join("\r\n")], {
    type: "text/csv;charset=utf-8;",
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${filename}_${dateStamp()}.csv`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

/**
 * Print rows as a refined PDF-ready report via a hidden iframe
 * (the browser's print dialog offers "Save as PDF").
 */
export function printReport(
  title: string,
  meta: string,
  headers: string[],
  rows: (string | number | null | undefined)[][],
) {
  const escapeHtml = (value: string | number | null | undefined) =>
    String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");

  const thead = headers
    .map((h) => `<th>${escapeHtml(h)}</th>`)
    .join("");
  const tbody = rows
    .map(
      (row) =>
        `<tr>${row.map((cell) => `<td>${escapeHtml(cell)}</td>`).join("")}</tr>`,
    )
    .join("");

  const html = `<!doctype html>
<html lang="tr">
<head>
<meta charset="utf-8" />
<title>${escapeHtml(title)}</title>
<style>
  @page { margin: 18mm 16mm; }
  * { box-sizing: border-box; }
  body {
    font-family: "Georgia", "Times New Roman", serif;
    color: #2b2722;
    margin: 0;
    padding: 24px;
  }
  .report-head {
    display: flex; align-items: baseline; justify-content: space-between;
    border-bottom: 1.5px solid #2b2722;
    padding-bottom: 12px; margin-bottom: 4px;
  }
  h1 { font-size: 22px; font-weight: 600; margin: 0; letter-spacing: 0.01em; }
  .meta { font-size: 11px; letter-spacing: 0.14em; text-transform: uppercase; color: #6b6358; }
  .sub { font-size: 11px; color: #6b6358; margin: 6px 0 18px; }
  table { width: 100%; border-collapse: collapse; font-size: 11px; }
  th {
    text-align: left; font-size: 9.5px; letter-spacing: 0.1em; text-transform: uppercase;
    color: #6b6358; font-weight: 600;
    border-bottom: 1px solid #2b2722; padding: 6px 8px;
  }
  td { border-bottom: 1px solid #e3ddd2; padding: 6px 8px; vertical-align: top; }
  tr:last-child td { border-bottom: none; }
  .count { font-size: 10.5px; color: #6b6358; margin-top: 14px; }
</style>
</head>
<body>
  <div class="report-head">
    <h1>${escapeHtml(title)}</h1>
    <div class="meta">${escapeHtml(meta)}</div>
  </div>
  <div class="sub">${escapeHtml("Kira Takip — gayrimenkul yönetim paneli")}</div>
  <table>
    <thead><tr>${thead}</tr></thead>
    <tbody>${tbody}</tbody>
  </table>
  <div class="count">${rows.length} kayıt</div>
</body>
</html>`;

  const iframe = document.createElement("iframe");
  iframe.setAttribute("aria-hidden", "true");
  iframe.style.position = "fixed";
  iframe.style.right = "0";
  iframe.style.bottom = "0";
  iframe.style.width = "0";
  iframe.style.height = "0";
  iframe.style.border = "0";
  iframe.srcdoc = html;
  document.body.appendChild(iframe);
  iframe.onload = () => {
    try {
      iframe.contentWindow?.focus();
      iframe.contentWindow?.print();
    } catch {
      // Popup/print blocked — ignore
    }
    setTimeout(() => iframe.remove(), 60_000);
  };
}

/**
 * Print a fully-formed HTML document (one that already contains its own
 * <html> shell and styles, e.g. the official rental contract preview).
 */
export function printHtmlDocument(html: string) {
  const iframe = document.createElement("iframe");
  iframe.setAttribute("aria-hidden", "true");
  iframe.style.position = "fixed";
  iframe.style.right = "0";
  iframe.style.bottom = "0";
  iframe.style.width = "0";
  iframe.style.height = "0";
  iframe.style.border = "0";
  iframe.srcdoc = html;
  document.body.appendChild(iframe);
  iframe.onload = () => {
    try {
      iframe.contentWindow?.focus();
      iframe.contentWindow?.print();
    } catch {
      // Popup/print blocked — ignore
    }
    setTimeout(() => iframe.remove(), 60_000);
  };
}
