import { money } from "./zn-types";
import type { ClientPayload, LaborRow, PartRow } from "./zn-types";

type Props = {
  dealId: number;
  title: string;
  client: ClientPayload | null;
  vehicle: string;
  vin?: string;
  plate?: string;
  mileage?: string;
  labor: LaborRow[];
  parts: PartRow[];
  total: number;
  paid: number;
  balance: number;
  companyName?: string;
};

function openPrint(html: string, docTitle: string) {
  const win = window.open("", "_blank", "noopener,noreferrer,width=900,height=700");
  if (!win) return;
  win.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${docTitle}</title>
<style>
  body{font-family:Segoe UI,Arial,sans-serif;font-size:13px;color:#111;padding:24px;max-width:800px;margin:0 auto}
  h1{font-size:18px;margin:0 0 8px} h2{font-size:15px;margin:16px 0 8px}
  .meta{color:#555;margin-bottom:16px;line-height:1.5}
  table{width:100%;border-collapse:collapse;margin:8px 0 16px}
  th,td{border:1px solid #ccc;padding:6px 8px;text-align:left}
  th{background:#f3f4f6}
  .right{text-align:right}
  .totals{margin-top:8px;text-align:right}
  .sign{display:flex;justify-content:space-between;margin-top:40px}
  @media print{body{padding:0}}
</style></head><body>${html}</body></html>`);
  win.document.close();
  win.focus();
  setTimeout(() => win.print(), 250);
}

export function ZnPrintReports({
  dealId,
  title,
  client,
  vehicle,
  vin,
  plate,
  mileage,
  labor,
  parts,
  total,
  paid,
  balance,
  companyName = "АвтоПлан",
}: Props) {
  const clientLine = [client?.name, client?.phone].filter(Boolean).join(" · ") || "—";
  const autoLine = [vehicle, plate && `г/н ${plate}`, vin && `VIN ${vin}`, mileage && `пробег ${mileage}`]
    .filter(Boolean)
    .join(" · ");

  const laborRows = labor
    .map(
      (r, i) =>
        `<tr><td>${i + 1}</td><td>${r.name || "—"}${r.code ? `<br><small>${r.code}</small>` : ""}</td><td class="right">${r.normHours ?? r.hours ?? "—"}</td><td class="right">${money(r.price)}</td></tr>`,
    )
    .join("");

  const partRows = parts
    .map(
      (r, i) =>
        `<tr><td>${i + 1}</td><td>${r.name || r.article || "—"}${r.article ? `<br><small>${r.article}</small>` : ""}</td><td class="right">${r.qty ?? 1}</td><td class="right">${money(r.price)}</td><td class="right">${money((Number(r.price) || 0) * (Number(r.qty) || 1))}</td></tr>`,
    )
    .join("");

  const header = `
    <h1>${companyName}</h1>
    <div class="meta">
      <div><strong>${title || `Заказ-наряд № ${dealId}`}</strong></div>
      <div>Клиент: ${clientLine}</div>
      <div>Авто: ${autoLine || "—"}</div>
      <div>Дата печати: ${new Date().toLocaleString("ru-RU")}</div>
    </div>`;

  const totals = `
    <div class="totals">
      <div>Итого: <strong>${money(total)}</strong></div>
      <div>Оплачено: ${money(paid)}</div>
      <div>К оплате: <strong>${money(balance)}</strong></div>
    </div>
    <div class="sign"><span>Заказчик ____________</span><span>Исполнитель ____________</span></div>`;

  const printZn = () => {
    openPrint(
      `${header}
      <h2>Работы</h2>
      <table><thead><tr><th>№</th><th>Наименование</th><th>Н/ч</th><th>Сумма</th></tr></thead>
      <tbody>${laborRows || `<tr><td colspan="4">—</td></tr>`}</tbody></table>
      <h2>Товары</h2>
      <table><thead><tr><th>№</th><th>Наименование</th><th>Кол-во</th><th>Цена</th><th>Сумма</th></tr></thead>
      <tbody>${partRows || `<tr><td colspan="5">—</td></tr>`}</tbody></table>
      ${totals}`,
      `ЗН-${dealId}`,
    );
  };

  const printAct = () => {
    openPrint(
      `${header}
      <h2>Акт выполненных работ</h2>
      <p>Настоящий акт составлен о том, что работы по заказ-наряду № ${dealId} выполнены в полном объёме.</p>
      <table><thead><tr><th>№</th><th>Наименование</th><th>Н/ч</th><th>Сумма</th></tr></thead>
      <tbody>${laborRows || `<tr><td colspan="4">—</td></tr>`}</tbody></table>
      ${partRows ? `<h2>Запчасти и материалы</h2><table><thead><tr><th>№</th><th>Наименование</th><th>Кол-во</th><th>Цена</th><th>Сумма</th></tr></thead><tbody>${partRows}</tbody></table>` : ""}
      ${totals}`,
      `Акт-${dealId}`,
    );
  };

  const printInvoice = () => {
    openPrint(
      `${header}
      <h2>Счёт на оплату</h2>
      <table><thead><tr><th>№</th><th>Наименование</th><th>Кол-во / н/ч</th><th>Сумма</th></tr></thead>
      <tbody>
        ${labor.map((r, i) => `<tr><td>${i + 1}</td><td>${r.name || "Работа"}</td><td class="right">${r.normHours ?? r.hours ?? 1}</td><td class="right">${money(r.price)}</td></tr>`).join("")}
        ${parts.map((r, i) => `<tr><td>${labor.length + i + 1}</td><td>${r.name || r.article || "Товар"}</td><td class="right">${r.qty ?? 1}</td><td class="right">${money((Number(r.price) || 0) * (Number(r.qty) || 1))}</td></tr>`).join("")}
      </tbody></table>
      <div class="totals"><div>К оплате: <strong>${money(balance > 0 ? balance : total)}</strong></div></div>
      <div class="sign"><span>Получатель ____________</span><span>Плательщик ____________</span></div>`,
      `Счёт-${dealId}`,
    );
  };

  return (
    <div className="zn-print-bar">
      <span className="zn-muted">Отчёты / печать</span>
      <button type="button" className="crm-btn crm-btn-sm" onClick={printZn}>
        Заказ-наряд
      </button>
      <button type="button" className="crm-btn crm-btn-sm" onClick={printAct}>
        Акт работ
      </button>
      <button type="button" className="crm-btn crm-btn-sm" onClick={printInvoice}>
        Счёт
      </button>
      <button
        type="button"
        className="crm-btn crm-btn-sm crm-btn-primary"
        onClick={() => {
          printZn();
          setTimeout(printAct, 400);
          setTimeout(printInvoice, 800);
        }}
      >
        Все документы
      </button>
    </div>
  );
}
