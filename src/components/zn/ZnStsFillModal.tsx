import { useState } from "react";
import { apiFetch } from "../../lib/fetch-api";
import { useToast } from "../../lib/toast";

type StsParsed = {
  plate: string | null;
  vin: string | null;
  make: string | null;
  model: string | null;
  year: number | null;
  ownerName: string | null;
};

type Props = {
  open: boolean;
  onClose: () => void;
  onApply: (parsed: StsParsed & { displayPlate: string | null }) => void;
};

export function ZnStsFillModal({ open, onClose, onApply }: Props) {
  const { toast } = useToast();
  const [front, setFront] = useState<File | null>(null);
  const [back, setBack] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<string | null>(null);

  if (!open) return null;

  const run = async () => {
    if (!front && !back) {
      toast("Загрузите фото СТС (лицевая и/или оборот)", "error");
      return;
    }
    setBusy(true);
    try {
      const fd = new FormData();
      if (front) fd.append("front", front);
      if (back) fd.append("back", back);
      const res = await apiFetch<{
        parsed: StsParsed;
        ocrPreview?: string;
        displayPlate: string | null;
      }>("/api/vehicles/recognize-sts", { method: "POST", body: fd });
      setPreview(res.ocrPreview || null);
      onApply({ ...res.parsed, displayPlate: res.displayPlate });
      toast("Данные со СТС распознаны", "success");
      onClose();
    } catch (e) {
      toast(e instanceof Error ? e.message : "Ошибка OCR", "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="zn-modal-backdrop" role="dialog" aria-modal="true">
      <div className="zn-modal">
        <div className="zn-modal__head">
          <h2>Заполнить ЗН из СТС</h2>
          <button type="button" className="crm-btn crm-btn-ghost" onClick={onClose}>
            ✕
          </button>
        </div>
        <p className="zn-muted">
          Загрузите фото лицевой и оборотной стороны свидетельства о регистрации. Поля VIN, госномер,
          марка/модель подставятся автоматически.
        </p>
        <div className="zn-sts-files">
          <label className="zn-field">
            <span>Лицевая сторона</span>
            <input
              type="file"
              accept="image/*"
              capture="environment"
              onChange={(e) => setFront(e.target.files?.[0] || null)}
            />
            {front && <span className="zn-muted">{front.name}</span>}
          </label>
          <label className="zn-field">
            <span>Оборотная сторона</span>
            <input
              type="file"
              accept="image/*"
              capture="environment"
              onChange={(e) => setBack(e.target.files?.[0] || null)}
            />
            {back && <span className="zn-muted">{back.name}</span>}
          </label>
        </div>
        {preview && (
          <pre className="zn-ocr-preview">{preview}</pre>
        )}
        <div className="zn-modal__actions">
          <button type="button" className="crm-btn" onClick={onClose} disabled={busy}>
            Отмена
          </button>
          <button type="button" className="crm-btn crm-btn-primary" onClick={run} disabled={busy}>
            {busy ? "Распознаём…" : "Распознать и заполнить"}
          </button>
        </div>
      </div>
    </div>
  );
}
