import PrintExportButton, { type PrintExportButtonProps } from "./PrintExportButton";

interface PageHeaderProps {
  title: string;
  subtitle?: string;
  /** Project name shown as centered top line in print header */
  printProjectName?: string;
  /** Secondary text shown below subtitle (e.g. ID, number) */
  secondaryText?: string;
  printTargetId?: string;
  /** Forwarded to PrintExportButton when printTargetId is set */
  printOptions?: Pick<PrintExportButtonProps, "printDocumentTitle" | "omitDefaultHeader" | "additionalPrintCss">;
  actions?: React.ReactNode;
}

export default function PageHeader({
  title,
  subtitle,
  printProjectName,
  secondaryText,
  printTargetId,
  printOptions,
  actions,
}: PageHeaderProps) {
  return (
    <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <div>
        <h1 className="text-2xl font-bold uppercase tracking-wider">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p>}
        {secondaryText && <p className="mt-0.5 text-sm text-foreground/90">{secondaryText}</p>}
      </div>
      <div className="flex items-center gap-2">
        {printTargetId && (
          <PrintExportButton
            title={title}
            subtitle={subtitle}
            printProjectName={printProjectName}
            printTargetId={printTargetId}
            {...printOptions}
          />
        )}
        {actions}
      </div>
    </div>
  );
}
