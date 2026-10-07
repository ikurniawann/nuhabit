/** Shared A4 print CSS for PR/PO documents. Keep in normal flow so pages paginate. */
const PRINT_DOCUMENT_CSS = `
@media print {
  @page {
    size: A4;
    margin: 12mm;
  }
  html,
  body {
    margin: 0 !important;
    padding: 0 !important;
    background: #ffffff !important;
    print-color-adjust: exact;
    -webkit-print-color-adjust: exact;
  }
  aside,
  header,
  .no-print,
  [data-sonner-toaster] {
    display: none !important;
  }
  .print-root,
  .print-sheet {
    position: static !important;
    box-shadow: none !important;
    border: 0 !important;
    border-radius: 0 !important;
    margin: 0 !important;
    max-width: none !important;
    width: 100% !important;
    min-height: 0 !important;
    padding: 0 !important;
    background: #ffffff !important;
  }
  .print-keep {
    break-inside: avoid;
    page-break-inside: avoid;
  }
  .print-break-after-avoid {
    break-after: avoid;
    page-break-after: avoid;
  }
  .print-table-wrap {
    overflow: visible !important;
    border-radius: 0 !important;
  }
  table {
    border-collapse: collapse;
    width: 100%;
  }
  thead {
    display: table-header-group;
  }
  tfoot {
    display: table-row-group;
  }
  tr,
  td,
  th {
    break-inside: avoid;
    page-break-inside: avoid;
  }
}
`;

export function PrintDocumentStyles() {
  return <style dangerouslySetInnerHTML={{ __html: PRINT_DOCUMENT_CSS }} />;
}
