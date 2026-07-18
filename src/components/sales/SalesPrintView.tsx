import { createRoot } from "react-dom/client";
import {
  formatDocDate,
  formatMoney,
  lineTotal,
  paymentMethodLabel,
  salesDocTypeLabel,
  type SalesDocument,
  type SalesDocumentItem,
} from "../../lib/sales-documents";

type CompanyInfo = {
  companyName?: string | null;
  companyInn?: string | null;
  companyAddress?: string | null;
  companyPhone?: string | null;
};

type Props = {
  doc: SalesDocument;
  items: SalesDocumentItem[];
  manager?: { name?: string | null } | null;
  company?: CompanyInfo | null;
  printVariant?: "default" | "receipt";
  showArticles?: boolean;
};

export function SalesPrintView({
  doc,
  items,
  manager,
  company,
  printVariant = "default",
  showArticles = true,
}: Props) {
  const isReceipt = printVariant === "receipt";
  const title = (isReceipt ? "Товарный чек" : salesDocTypeLabel(doc.docType)).toUpperCase();
  const companyName = doc.companyName || company?.companyName || "—";
  const subtotal = items.reduce((sum, row) => sum + lineTotal(row.qty, row.price), 0);
  const date = doc.postedAt || doc.createdAt;

  return (
    <div className="sales-print">
      <header className="sales-print__head">
        <div>
          <strong style={{ fontSize: 16 }}>{companyName}</strong>
          {company?.companyInn && <div style={{ fontSize: 11 }}>ИНН {company.companyInn}</div>}
          {company?.companyAddress && <div style={{ fontSize: 11 }}>{company.companyAddress}</div>}
          {company?.companyPhone && <div style={{ fontSize: 11 }}>тел. {company.companyPhone}</div>}
        </div>
        <div style={{ textAlign: "right" }}>
          <div style={{ fontWeight: 700, fontSize: 14 }}>{title}</div>
          <div>№ {doc.docNumber}</div>
          <div style={{ fontSize: 11 }}>{formatDocDate(date)}</div>
        </div>
      </header>

      {!isReceipt && doc.docType === "invoice" && (doc.recipientName || doc.recipientPhone) && (
        <div className="sales-print__block">
          <div style={{ fontSize: 11, color: "#555" }}>Получатель</div>
          <div style={{ fontWeight: 600 }}>{doc.recipientName || "—"}</div>
          {doc.recipientPhone && <div style={{ fontSize: 12 }}>{doc.recipientPhone}</div>}
        </div>
      )}

      {isReceipt && doc.recipientName && (
        <div className="sales-print__block">
          <div style={{ fontSize: 11, color: "#555" }}>Покупатель</div>
          <div style={{ fontWeight: 600 }}>{doc.recipientName}</div>
          {doc.recipientPhone && <div style={{ fontSize: 12 }}>{doc.recipientPhone}</div>}
        </div>
      )}

      <table className="sales-print__table">
        <thead>
          <tr>
            <th>№</th>
            {showArticles && <th>Артикул</th>}
            <th>Наименование</th>
            <th>Кол-во</th>
            <th>Цена</th>
            <th>Сумма</th>
          </tr>
        </thead>
        <tbody>
          {items.map((row, index) => (
            <tr key={row.id ?? index}>
              <td>{index + 1}</td>
              {showArticles && <td>{row.article || "—"}</td>}
              <td>{row.brand ? `${row.brand} · ${row.name}` : row.name}</td>
              <td>{row.qty ?? 1}</td>
              <td>{formatMoney(row.price)}</td>
              <td>{formatMoney(lineTotal(row.qty, row.price))}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="sales-print__totals">
        <div>
          Итого по позициям: <strong>{formatMoney(subtotal)}</strong>
        </div>
        {(doc.rounding ?? 0) !== 0 && (
          <div>
            Округление: <strong>{formatMoney(doc.rounding)}</strong>
          </div>
        )}
        <div style={{ fontSize: 15, marginTop: 6 }}>
          К оплате: <strong>{formatMoney(doc.totalAmount ?? subtotal + (doc.rounding ?? 0))}</strong>
        </div>
        {doc.paymentMethod && (
          <div style={{ marginTop: 4, fontSize: 12 }}>
            Оплата: {paymentMethodLabel(doc.paymentMethod)}
            {doc.paymentAmount != null && ` · ${formatMoney(doc.paymentAmount)}`}
          </div>
        )}
      </div>

      {doc.notes && (
        <div className="sales-print__block" style={{ marginTop: 12 }}>
          <div style={{ fontSize: 11, color: "#555" }}>Примечание</div>
          <div>{doc.notes}</div>
        </div>
      )}

      {doc.warrantyText && (
        <div className="sales-print__block" style={{ marginTop: 12 }}>
          <div style={{ fontSize: 11, color: "#555" }}>Гарантия</div>
          <div style={{ whiteSpace: "pre-wrap" }}>{doc.warrantyText}</div>
        </div>
      )}

      <div className="sales-print__sign">
        <span>Менеджер: {manager?.name || "________________"}</span>
        <span>Подпись: ________________</span>
      </div>
    </div>
  );
}

const PRINT_CSS = `
  body { font-family: Arial, sans-serif; font-size: 12px; color: #111; margin: 24px; }
  .sales-print__head { display: flex; justify-content: space-between; gap: 16px; margin-bottom: 16px; }
  .sales-print__table { width: 100%; border-collapse: collapse; margin: 12px 0; }
  .sales-print__table th, .sales-print__table td { border: 1px solid #ccc; padding: 6px 8px; text-align: left; }
  .sales-print__table th { background: #f5f5f5; }
  .sales-print__totals { text-align: right; margin-top: 8px; }
  .sales-print__block { margin-top: 8px; }
  .sales-print__sign { display: flex; justify-content: space-between; margin-top: 32px; font-size: 12px; }
`;

export function printSalesDocument(props: Props) {
  const win = window.open("", "_blank", "width=800,height=900");
  if (!win) return;
  win.document.write(`<!DOCTYPE html><html lang="ru"><head><meta charset="utf-8" /><title>Печать документа</title><style>${PRINT_CSS}</style></head><body><div id="root"></div></body></html>`);
  win.document.close();
  const mount = win.document.getElementById("root");
  if (!mount) return;
  const root = createRoot(mount);
  root.render(<SalesPrintView {...props} />);
  requestAnimationFrame(() => {
    win.focus();
    win.print();
  });
}
