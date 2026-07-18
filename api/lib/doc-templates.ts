import type { DocTemplateData, DocType } from "./doc-types";

function esc(s: string | number | null | undefined): string {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function money(n: number): string {
  return n.toLocaleString("ru-RU", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function partyBlock(title: string, p: DocTemplateData["tenant"]): string {
  return `
    <div class="party">
      <div class="party__title">${esc(title)}</div>
      <div><strong>${esc(p.name || "—")}</strong></div>
      <div>Адрес: ${esc(p.address || "—")}</div>
      <div>Тел.: ${esc(p.phone || "—")}</div>
      <div>ИНН: ${esc(p.inn || "—")} · КПП: ${esc(p.kpp || "—")}</div>
      ${p.bank ? `<div>Банк: ${esc(p.bank)}</div>` : ""}
      ${p.bik || p.rs ? `<div>БИК: ${esc(p.bik || "—")} · р/с: ${esc(p.rs || "—")}</div>` : ""}
      ${p.ks ? `<div>к/с: ${esc(p.ks)}</div>` : ""}
    </div>`;
}

function itemsTable(data: DocTemplateData): string {
  const rows = data.items
    .map(
      (it, i) => `
      <tr>
        <td>${i + 1}</td>
        <td>${esc(it.name)}</td>
        <td>${esc(it.unit)}</td>
        <td class="num">${esc(it.qty)}</td>
        <td class="num">${money(it.price)}</td>
        <td class="num">${money(it.total)}</td>
        <td class="num">${money(it.vat)}</td>
      </tr>`,
    )
    .join("");
  return `
    <table class="items">
      <thead>
        <tr>
          <th>№</th>
          <th>Наименование</th>
          <th>Ед.</th>
          <th>Кол-во</th>
          <th>Цена</th>
          <th>Сумма</th>
          <th>НДС</th>
        </tr>
      </thead>
      <tbody>${rows || `<tr><td colspan="7">Нет позиций</td></tr>`}</tbody>
    </table>`;
}

function totals(data: DocTemplateData): string {
  return `
    <div class="totals">
      <div>Сумма без НДС: <strong>${money(data.subtotal)} ₽</strong></div>
      <div>${esc(data.vatLabel)}: <strong>${money(data.vatTotal)} ₽</strong></div>
      <div class="totals__grand">Итого к оплате: <strong>${money(data.total)} ₽</strong></div>
    </div>`;
}

function baseStyles(): string {
  return `
    * { box-sizing: border-box; }
    body {
      font-family: "Liberation Sans", Arial, Helvetica, sans-serif;
      font-size: 11pt;
      color: #111;
      margin: 0;
      padding: 0;
    }
    .sheet { position: relative; padding: 8mm 0; }
    .wm {
      position: fixed; top: 40%; left: 10%; right: 10%;
      text-align: center; font-size: 64pt; color: rgba(0,0,0,0.06);
      transform: rotate(-28deg); z-index: 0; pointer-events: none;
    }
    .content { position: relative; z-index: 1; }
    h1 { font-size: 16pt; margin: 0 0 8px; }
    .meta { margin-bottom: 14px; line-height: 1.45; }
    .grid2 { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-bottom: 14px; }
    .party { border: 1px solid #333; padding: 8px 10px; min-height: 90px; }
    .party__title { font-size: 9pt; text-transform: uppercase; letter-spacing: 0.04em; margin-bottom: 4px; color: #444; }
    .items { width: 100%; border-collapse: collapse; margin: 10px 0; }
    .items th, .items td { border: 1px solid #333; padding: 5px 6px; vertical-align: top; }
    .items th { background: #eee; font-size: 9pt; text-align: left; }
    .num { text-align: right; white-space: nowrap; }
    .totals { text-align: right; margin-top: 10px; line-height: 1.7; }
    .totals__grand { font-size: 13pt; margin-top: 6px; padding-top: 6px; border-top: 2px solid #111; }
    .vehicle { margin: 8px 0 12px; line-height: 1.5; }
    .sign { display: grid; grid-template-columns: 1fr 1fr; gap: 24px; margin-top: 28px; font-size: 10pt; }
    .sign__line { margin-top: 28px; border-top: 1px solid #333; padding-top: 4px; }
    .qr { margin-top: 12px; text-align: right; }
    .qr img { width: 110px; height: 110px; }
    .note { margin-top: 12px; font-size: 9pt; color: #333; line-height: 1.4; }
    .upd-head { border: 2px solid #111; padding: 8px; margin-bottom: 12px; }
  `;
}

function shell(data: DocTemplateData, body: string): string {
  return `<!DOCTYPE html>
<html lang="ru">
<head>
  <meta charset="utf-8" />
  <title>${esc(data.title)} ${esc(data.docNumber)}</title>
  <style>${baseStyles()}</style>
</head>
<body>
  <div class="sheet">
    <div class="wm">${esc(data.watermark)}</div>
    <div class="content">${body}</div>
  </div>
</body>
</html>`;
}

function invoiceHtml(data: DocTemplateData): string {
  return shell(
    data,
    `
    <h1>${esc(data.title)} № ${esc(data.docNumber)}</h1>
    <div class="meta">от ${esc(data.date)}</div>
    <div class="grid2">
      ${partyBlock("Исполнитель (СТО)", data.tenant)}
      ${partyBlock("Заказчик", data.client)}
    </div>
    ${itemsTable(data)}
    ${totals(data)}
    ${
      data.qrDataUrl
        ? `<div class="qr"><div>Оплата по СБП</div><img src="${data.qrDataUrl}" alt="QR СБП" /></div>`
        : ""
    }
    <div class="note">Срок оплаты — 5 банковских дней с даты выставления счёта. Точная стоимость работ может уточняться после диагностики.</div>
    <div class="sign">
      <div><div class="sign__line">Исполнитель</div></div>
      <div><div class="sign__line">Заказчик</div></div>
    </div>`,
  );
}

function updHtml(data: DocTemplateData): string {
  return shell(
    data,
    `
    <div class="upd-head">
      <h1 style="margin:0">${esc(data.title)}</h1>
      <div>Статус: 1 (счёт-фактура и передаточный документ)</div>
      <div>№ ${esc(data.docNumber)} от ${esc(data.date)}</div>
    </div>
    <div class="grid2">
      ${partyBlock("Грузоотправитель / продавец", data.tenant)}
      ${partyBlock("Грузополучатель / покупатель", data.client)}
    </div>
    ${itemsTable(data)}
    ${totals(data)}
    <div class="note">Документ сформирован в CRM для печати/ознакомления. Для ЭДО (Диадок/СБИС) требуется XML-УПД — отдельно.</div>
    <div class="sign">
      <div><div class="sign__line">Руководитель / уполномоченное лицо</div></div>
      <div><div class="sign__line">Покупатель / уполномоченное лицо</div></div>
    </div>`,
  );
}

function actHtml(data: DocTemplateData): string {
  return shell(
    data,
    `
    <h1>${esc(data.title)} № ${esc(data.docNumber)}</h1>
    <div class="meta">от ${esc(data.date)} · к заказ-наряду № ${esc(data.dealId)}</div>
    <div class="grid2">
      ${partyBlock("Исполнитель", data.tenant)}
      ${partyBlock("Заказчик", data.client)}
    </div>
    <div class="vehicle">
      <div><strong>Автомобиль:</strong> ${esc(data.vehicle.makeModel || "—")}</div>
      <div><strong>VIN:</strong> ${esc(data.vehicle.vin || "—")} · <strong>Госномер:</strong> ${esc(data.vehicle.plate || "—")}</div>
      <div><strong>Пробег:</strong> ${esc(data.vehicle.mileage || "—")}</div>
    </div>
    ${itemsTable(data)}
    ${totals(data)}
    <div class="note"><strong>Гарантийные обязательства:</strong> ${esc(data.warranty || "По регламенту СТО и производителя запчастей.")}</div>
    <div class="sign">
      <div><div class="sign__line">Исполнитель</div></div>
      <div><div class="sign__line">Заказчик (работы принял)</div></div>
    </div>`,
  );
}

function orderHtml(data: DocTemplateData): string {
  return shell(
    data,
    `
    <h1>${esc(data.title)} № ${esc(data.docNumber)}</h1>
    <div class="meta">от ${esc(data.date)}</div>
    <div class="grid2">
      ${partyBlock("СТО", data.tenant)}
      ${partyBlock("Клиент", data.client)}
    </div>
    <div class="vehicle">
      <div><strong>Автомобиль:</strong> ${esc(data.vehicle.makeModel || "—")}</div>
      <div><strong>VIN:</strong> ${esc(data.vehicle.vin || "—")} · <strong>Госномер:</strong> ${esc(data.vehicle.plate || "—")}</div>
      <div><strong>Пробег:</strong> ${esc(data.vehicle.mileage || "—")}</div>
    </div>
    ${itemsTable(data)}
    ${totals(data)}
    <div class="note"><strong>Гарантия:</strong> ${esc(data.warranty || "По регламенту СТО.")}</div>
    <div class="sign">
      <div><div class="sign__line">Мастер-приёмщик</div></div>
      <div><div class="sign__line">Клиент</div></div>
    </div>`,
  );
}

export function getHtmlTemplate(type: DocType, data: DocTemplateData): string {
  switch (type) {
    case "invoice":
      return invoiceHtml(data);
    case "upd":
      return updHtml(data);
    case "act":
      return actHtml(data);
    case "order":
      return orderHtml(data);
    default: {
      const _exhaustive: never = type;
      return _exhaustive;
    }
  }
}
