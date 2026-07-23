import type { ReactNode } from "react";

type Props = {
  query: string;
  entityLabel: string;
  /** Добавить только в текущий документ (без справочника) */
  onCreateInDocument?: () => void;
  /** Сохранить в справочник (склад / каталог / клиенты) */
  onSaveToDirectory?: () => void;
  documentLabel?: string;
  directoryLabel?: string;
  /** Доп. форма под кнопками (цена, ФИО и т.д.) */
  children?: ReactNode;
  hint?: string;
};

/**
 * Единый UX: «не нашли в поиске» → создать в документе и/или сохранить в справочник навсегда.
 */
export function SearchNotFoundCreate({
  query,
  entityLabel,
  onCreateInDocument,
  onSaveToDirectory,
  documentLabel = "Добавить только в документ",
  directoryLabel = "Сохранить в справочник",
  children,
  hint,
}: Props) {
  const q = query.trim();
  return (
    <div className="search-miss">
      <p className="search-miss__title">
        {entityLabel}: «{q}» — в справочнике нет
      </p>
      <p className="search-miss__hint">
        {hint ||
          "Можно добавить в этот документ или сохранить в справочник — тогда позиция будет доступна везде."}
      </p>
      <div className="search-miss__actions">
        {onCreateInDocument && (
          <button type="button" className="crm-btn" onClick={onCreateInDocument}>
            {documentLabel}
          </button>
        )}
        {onSaveToDirectory && (
          <button type="button" className="crm-btn crm-btn-primary" onClick={onSaveToDirectory}>
            {directoryLabel}
          </button>
        )}
      </div>
      {children}
    </div>
  );
}
