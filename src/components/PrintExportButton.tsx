import { Printer, FileDown } from "lucide-react";
import { Button } from "@/components/ui/button";

function escapeHtml(text: string) {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export interface PrintExportButtonProps {
  title: string;
  subtitle?: string;
  printProjectName?: string;
  printTargetId: string;
  /** Browser tab / default heading text when default header is shown */
  printDocumentTitle?: string;
  /** If true, only the target element HTML is printed (no app-generated h1 + date). */
  omitDefaultHeader?: boolean;
  /** Extra CSS appended after base print styles (e.g. toggle screen vs print sections). */
  additionalPrintCss?: string;
}

export default function PrintExportButton({
  title,
  subtitle,
  printProjectName,
  printTargetId,
  printDocumentTitle,
  omitDefaultHeader = false,
  additionalPrintCss = "",
}: PrintExportButtonProps) {
  const handlePrint = () => {
    const content = document.getElementById(printTargetId);
    if (!content) return;

    const printWindow = window.open("", "_blank");
    if (!printWindow) return;

    const docTitle = escapeHtml(printDocumentTitle ?? title);
    const safeAdditionalCss = additionalPrintCss.replace(/<\/style/gi, "<\\/style");

    const projectHeading = printProjectName?.trim() || subtitle?.trim() || docTitle;
    const secondaryHeading = subtitle?.trim() ? docTitle : "";

    const defaultHeaderBlock = omitDefaultHeader
      ? ""
      : `
        <div class="print-header">
          <div class="print-project">${escapeHtml(projectHeading)}</div>
          ${secondaryHeading ? `<h1 class="print-secondary-heading">${escapeHtml(secondaryHeading)}</h1>` : ""}
        </div>
      `;

    printWindow.document.write(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>${docTitle}</title>
        <style>
          body { font-family: Arial, Helvetica, sans-serif; padding: 20px; color: #000; }
          h1 { font-size: 18px; border-bottom: 2px solid #000; padding-bottom: 8px; margin-bottom: 16px; text-transform: uppercase; letter-spacing: 2px; }
          table { width: 100%; border-collapse: collapse; margin-top: 12px; }
          th, td { border: 1px solid #000; padding: 8px 12px; text-align: left; font-size: 12px; }
          th { background-color: #000; color: #fff; font-weight: bold; text-transform: uppercase; letter-spacing: 1px; }
          tr:nth-child(even) { background-color: #f5f5f5; }
          .print-header { margin-bottom: 16px; text-align: center; }
          .print-project { font-size: 14px; font-weight: 700; margin: 0 0 6px; text-transform: uppercase; letter-spacing: 0.04em; }
          .print-secondary-heading { margin: 0 0 10px; border-bottom: 2px solid #000; padding-bottom: 8px; }
          a { color: inherit !important; text-decoration: none !important; }
          button, [role="button"], .print-hidden, .employees-print-screen-only, .cash-controls, .kpi-card, .stat-card { display: none !important; }
          .print-hidden { display: none !important; }
          @media print { body { padding: 0; } }
          ${safeAdditionalCss}
        </style>
      </head>
      <body>
        ${defaultHeaderBlock}
        ${content.innerHTML}
      </body>
      </html>
    `);
    printWindow.document.close();
    printWindow.print();
  };

  return (
    <div className="flex gap-2">
      <Button variant="outline" size="sm" onClick={handlePrint}>
        <Printer className="h-4 w-4 mr-1" />
        Print
      </Button>
      <Button variant="outline" size="sm" onClick={handlePrint}>
        <FileDown className="h-4 w-4 mr-1" />
        Export PDF
      </Button>
    </div>
  );
}
