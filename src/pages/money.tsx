import { useLocation } from "wouter";
import { AppShell } from "../components/AppShell";
import { MONEY_PRIMARY, MONEY_RELATED } from "../lib/nav";

type Section =
  | "list"
  | "cash-orders"
  | "bank-statements"
  | "cashflow-report"
  | "bank-import"
  | "charts"
  | "client-advances"
  | "supplier-advances";

const TITLES: Record<Section, string> = {
  list: "Движение денежных средств",
  "cash-orders": "ПКО / РКО",
  "bank-statements": "Банковские выписки",
  "cashflow-report": "Отчёт о Движении Денежных Средств",
  "bank-import": "Загрузка банковских выписок",
  charts: "Графики",
  "client-advances": "Авансы клиентов",
  "supplier-advances": "Аванс поставщику",
};

function EmptyDash() {
  return <span className="money-dash">—</span>;
}

function sectionFromPath(path: string): Section {
  if (path === "/money" || path === "/money/") return "list";
  const rest = path.replace(/^\/money\/?/, "");
  if (rest in TITLES) return rest as Section;
  return "list";
}

function MoneyHelp({ section }: { section: Section }) {
  const [, setLocation] = useLocation();
  return (
    <aside className="money-help">
      <h3>Деньги</h3>
      <p>
        Кассовые документы и отчёты по всем учётным операциям, которые фиксируют поступление и
        движение средств на предприятии.
      </p>
      <div className="money-help__related">
        <div className="money-help__related-title">Связанные темы</div>
        {MONEY_RELATED.map((item) => (
          <button
            key={item.path}
            type="button"
            className="money-help__link"
            onClick={() => setLocation(item.path)}
          >
            <strong>{item.label}</strong>
            {item.hint && <span>{item.hint}</span>}
          </button>
        ))}
      </div>
      <div className="money-help__foot">
        <span>Справка: {TITLES[section]}</span>
      </div>
    </aside>
  );
}

function MoneyListSkeleton() {
  return (
    <>
      <div className="money-toolbar">
        <button type="button" className="crm-btn crm-btn-primary" disabled>
          +
        </button>
        <h1 className="money-title">Деньги</h1>
        <div className="money-balance-placeholder">
          Остаток <EmptyDash />
        </div>
        <input className="crm-input money-search" placeholder="Поиск…" disabled />
      </div>
      <div className="money-filters">
        <input className="crm-input" type="date" disabled title="Период с" />
        <input className="crm-input" type="date" disabled title="Период по" />
        <select className="crm-input" disabled>
          <option>Контрагент</option>
        </select>
        <select className="crm-input" disabled>
          <option>Ответственный</option>
        </select>
        <select className="crm-input" disabled>
          <option>Суммы</option>
        </select>
        <select className="crm-input" disabled>
          <option>Метки</option>
        </select>
      </div>
      <div className="money-table-wrap">
        <table className="money-table">
          <thead>
            <tr>
              <th />
              <th>№</th>
              <th>Дата</th>
              <th>Контрагент</th>
              <th>Сумма</th>
              <th>Счёт</th>
              <th>Статья</th>
            </tr>
          </thead>
          <tbody>
            {[1, 2, 3, 4, 5].map((i) => (
              <tr key={i}>
                <td>
                  <input type="checkbox" disabled />
                </td>
                <td>
                  <EmptyDash />
                </td>
                <td>
                  <EmptyDash />
                </td>
                <td className="money-muted">{i === 1 ? "Нет документов" : ""}</td>
                <td>
                  <EmptyDash />
                </td>
                <td>
                  <EmptyDash />
                </td>
                <td>
                  <EmptyDash />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="money-footer-stats">
        <span>
          Приход <EmptyDash />
        </span>
        <span>
          Расход <EmptyDash />
        </span>
        <span>
          Сальдо <EmptyDash />
        </span>
      </div>
    </>
  );
}

function CashOrdersSkeleton() {
  return (
    <>
      <div className="money-toolbar">
        <button type="button" className="crm-btn crm-btn-primary" disabled>
          + ПКО
        </button>
        <button type="button" className="crm-btn" disabled>
          + РКО
        </button>
        <h1 className="money-title">ПКО / РКО</h1>
      </div>
      <table className="money-table">
        <thead>
          <tr>
            <th>Тип</th>
            <th>№</th>
            <th>Дата</th>
            <th>Контрагент</th>
            <th>Сумма</th>
            <th>Основание</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td colSpan={6} className="money-muted">
              Кассовые ордера появятся здесь. Суммы в каркасе не отображаются.
            </td>
          </tr>
        </tbody>
      </table>
    </>
  );
}

function BankStatementsSkeleton() {
  return (
    <>
      <div className="money-toolbar">
        <h1 className="money-title">Банковские выписки</h1>
      </div>
      <table className="money-table">
        <thead>
          <tr>
            <th>Дата</th>
            <th>Счёт</th>
            <th>Назначение</th>
            <th>Приход</th>
            <th>Расход</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td colSpan={5} className="money-muted">
              Выписки банка — каркас без цифр.
            </td>
          </tr>
        </tbody>
      </table>
    </>
  );
}

function CashflowReportSkeleton() {
  return (
    <>
      <div className="money-toolbar">
        <h1 className="money-title">Отчёт о Движении Денежных Средств</h1>
      </div>
      <p className="money-muted" style={{ marginBottom: 12 }}>
        Отражает все поступления и выплаты, а также остатки за выбранный период.
      </p>
      <table className="money-table">
        <thead>
          <tr>
            <th>Статья</th>
            <th>Приход</th>
            <th>Расход</th>
            <th>Итого</th>
          </tr>
        </thead>
        <tbody>
          {["Операционная деятельность", "Инвестиции", "Финансирование"].map((row) => (
            <tr key={row}>
              <td>{row}</td>
              <td>
                <EmptyDash />
              </td>
              <td>
                <EmptyDash />
              </td>
              <td>
                <EmptyDash />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}

function BankImportSkeleton() {
  return (
    <>
      <div className="money-toolbar">
        <h1 className="money-title">Загрузка банковских выписок</h1>
      </div>
      <div className="money-import">
        <p className="money-muted">
          Загрузите файл выписки для автоматизации учёта. Суммы в каркасе не показываются.
        </p>
        <input type="file" disabled className="crm-input" />
        <button type="button" className="crm-btn crm-btn-primary" disabled>
          Загрузить
        </button>
      </div>
    </>
  );
}

function ChartsSkeleton() {
  return (
    <>
      <div className="money-toolbar">
        <h1 className="money-title">Графики</h1>
      </div>
      <div className="money-charts">
        <div className="money-chart-card">
          <div className="money-chart-card__title">Приход / расход</div>
          <div className="money-chart-card__body">Нет данных</div>
        </div>
        <div className="money-chart-card">
          <div className="money-chart-card__title">По статьям</div>
          <div className="money-chart-card__body">Нет данных</div>
        </div>
        <div className="money-chart-card">
          <div className="money-chart-card__title">По счетам</div>
          <div className="money-chart-card__body">Нет данных</div>
        </div>
      </div>
    </>
  );
}

function AdvancesSkeleton({ title }: { title: string }) {
  return (
    <>
      <div className="money-toolbar">
        <button type="button" className="crm-btn crm-btn-primary" disabled>
          +
        </button>
        <h1 className="money-title">{title}</h1>
      </div>
      <table className="money-table">
        <thead>
          <tr>
            <th>Контрагент</th>
            <th>Дата</th>
            <th>Сумма</th>
            <th>Остаток</th>
            <th>Примечание</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td colSpan={5} className="money-muted">
              Список пуст. Цифры не загружаются.
            </td>
          </tr>
        </tbody>
      </table>
    </>
  );
}

export default function MoneyPage() {
  const [path, setLocation] = useLocation();
  const section = sectionFromPath(path);

  return (
    <AppShell>
      <div className="money-page">
        <div className="money-subnav">
          {[...MONEY_PRIMARY, ...MONEY_RELATED].map((item) => {
            const itemSection = sectionFromPath(item.path);
            const isActive = itemSection === section;
            return (
              <button
                key={item.path + item.label}
                type="button"
                className={`money-subnav__btn${isActive ? " is-active" : ""}`}
                onClick={() => setLocation(item.path)}
              >
                {item.label}
              </button>
            );
          })}
        </div>
        <div className="money-layout">
          <div className="money-main">
            {section === "list" && <MoneyListSkeleton />}
            {section === "cash-orders" && <CashOrdersSkeleton />}
            {section === "bank-statements" && <BankStatementsSkeleton />}
            {section === "cashflow-report" && <CashflowReportSkeleton />}
            {section === "bank-import" && <BankImportSkeleton />}
            {section === "charts" && <ChartsSkeleton />}
            {section === "client-advances" && <AdvancesSkeleton title="Авансы клиентов" />}
            {section === "supplier-advances" && <AdvancesSkeleton title="Аванс поставщику" />}
          </div>
          <MoneyHelp section={section} />
        </div>
      </div>
    </AppShell>
  );
}
