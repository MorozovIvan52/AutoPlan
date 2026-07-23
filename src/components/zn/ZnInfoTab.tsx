import { dealStatusLabel } from "../../lib/utils";
import { VehicleMakeModelFields } from "../VehicleMakeModelFields";
import type { ClientPayload } from "./zn-types";
import { ZN_STATUSES } from "./zn-types";

type Props = {
  client: ClientPayload | null;
  assigneeName: string;
  title: string;
  setTitle: (v: string) => void;
  status: string;
  setStatus: (v: string) => void;
  description: string;
  setDescription: (v: string) => void;
  woNote: string;
  setWoNote: (v: string) => void;
  vin: string;
  setVin: (v: string) => void;
  plate: string;
  setPlate: (v: string) => void;
  make: string;
  setMake: (v: string) => void;
  model: string;
  setModel: (v: string) => void;
  year: string;
  setYear: (v: string) => void;
  mileage: string;
  setMileage: (v: string) => void;
  campaign: string;
  setCampaign: (v: string) => void;
  fieldErrors: Record<string, string>;
  onOpenSts: () => void;
};

export function ZnInfoTab(props: Props) {
  const err = (key: string) => props.fieldErrors[key];

  return (
    <div className="zn-grid">
      <div className="zn-field zn-field--wide zn-info-actions">
        <button type="button" className="crm-btn crm-btn-primary" onClick={props.onOpenSts}>
          Заполнить из СТС (2 фото)
        </button>
        <span className="zn-muted">OCR лицевой и оборотной стороны → VIN, госномер, марка</span>
      </div>

      <label className={`zn-field zn-field--wide${err("client") ? " is-invalid" : ""}`}>
        <span>Клиент *</span>
        <input readOnly value={props.client?.name || "—"} />
        <span className="zn-muted">{props.client?.phone || ""}</span>
        {err("client") && <span className="zn-field-error">{err("client")}</span>}
      </label>

      <label className={`zn-field zn-field--wide${err("title") ? " is-invalid" : ""}`}>
        <span>Причина обращения *</span>
        <input
          value={props.title}
          onChange={(e) => props.setTitle(e.target.value)}
          placeholder="Например: ремонт полного привода"
        />
        {err("title") && <span className="zn-field-error">{err("title")}</span>}
      </label>

      <label className="zn-field">
        <span>Статус *</span>
        <select value={props.status} onChange={(e) => props.setStatus(e.target.value)}>
          {ZN_STATUSES.map((s) => (
            <option key={s} value={s}>
              {dealStatusLabel(s)}
            </option>
          ))}
        </select>
      </label>

      <label className="zn-field">
        <span>Ответственный</span>
        <input readOnly value={props.assigneeName || "—"} />
      </label>

      <VehicleMakeModelFields
        make={props.make}
        model={props.model}
        onMakeChange={props.setMake}
        onModelChange={props.setModel}
      />
      <label className="zn-field">
        <span>Год</span>
        <input value={props.year} onChange={(e) => props.setYear(e.target.value)} inputMode="numeric" />
      </label>
      <label className="zn-field">
        <span>Госномер</span>
        <input value={props.plate} onChange={(e) => props.setPlate(e.target.value)} />
      </label>
      <label className="zn-field">
        <span>VIN</span>
        <input value={props.vin} onChange={(e) => props.setVin(e.target.value)} />
      </label>
      <label className={`zn-field${err("mileage") ? " is-invalid" : ""}`}>
        <span>Пробег, км *</span>
        <input
          value={props.mileage}
          onChange={(e) => props.setMileage(e.target.value)}
          inputMode="numeric"
          placeholder="0"
        />
        {err("mileage") && <span className="zn-field-error">{err("mileage")}</span>}
      </label>

      <label className={`zn-field zn-field--wide${err("campaign") ? " is-invalid" : ""}`}>
        <span>Рекламная кампания *</span>
        <input
          value={props.campaign}
          onChange={(e) => props.setCampaign(e.target.value)}
          placeholder="Откуда клиент узнал о сервисе"
        />
        {err("campaign") && <span className="zn-field-error">{err("campaign")}</span>}
      </label>

      <label className="zn-field zn-field--wide">
        <span>Особые отметки и рекомендации</span>
        <textarea rows={3} value={props.description} onChange={(e) => props.setDescription(e.target.value)} />
      </label>

      <label className="zn-field zn-field--wide">
        <span>Примечание к ЗН</span>
        <textarea rows={2} value={props.woNote} onChange={(e) => props.setWoNote(e.target.value)} />
      </label>
    </div>
  );
}
