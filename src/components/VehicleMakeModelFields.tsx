import { useEffect, useMemo, useRef, useState } from "react";
import {
  modelsForMake,
  suggestCars,
  suggestMakes,
  type CarSuggestion,
} from "../lib/car-makes-models";

type Props = {
  make: string;
  model: string;
  onMakeChange: (make: string) => void;
  onModelChange: (model: string) => void;
  makeLabel?: string;
  modelLabel?: string;
};

/**
 * Поиск марки/модели из глобального справочника + 5–7 подсказок «Марка Модель».
 * Если нет в списке — можно оставить введённое как есть (свободный ввод).
 */
export function VehicleMakeModelFields({
  make,
  model,
  onMakeChange,
  onModelChange,
  makeLabel = "Автомобиль — марка",
  modelLabel = "Модель",
}: Props) {
  const [open, setOpen] = useState<"make" | "model" | "combo" | null>(null);
  const [comboQ, setComboQ] = useState("");
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(null);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  const searchQ = open === "combo" ? comboQ : open === "make" ? make : open === "model" ? `${make} ${model}`.trim() : "";

  const carSuggestions = useMemo(() => {
    if (open === "make") return suggestCars(make, 7);
    if (open === "combo") return suggestCars(comboQ || `${make} ${model}`.trim(), 7);
    if (open === "model") {
      const models = modelsForMake(make);
      const q = model.trim().toLowerCase();
      const filtered = (q ? models.filter((m) => m.toLowerCase().includes(q)) : models).slice(0, 7);
      if (filtered.length) {
        return filtered.map((m) => ({
          make: make.trim() || "—",
          model: m,
          label: `${make.trim() || "—"} ${m}`,
          score: 1,
        }));
      }
      return suggestCars(model || make, 7);
    }
    return [] as CarSuggestion[];
  }, [open, make, model, comboQ]);

  const makeSuggestions = useMemo(() => (open === "make" ? suggestMakes(make, 7) : []), [open, make]);

  const pick = (s: CarSuggestion) => {
    onMakeChange(s.make);
    onModelChange(s.model);
    setComboQ(`${s.make} ${s.model}`);
    setOpen(null);
  };

  const useCustom = () => {
    const raw = (open === "combo" ? comboQ : open === "make" ? make : `${make} ${model}`).trim();
    if (!raw) return;
    const parts = raw.split(/\s+/);
    if (parts.length >= 2) {
      onMakeChange(parts[0]);
      onModelChange(parts.slice(1).join(" "));
    } else if (open === "make" || open === "combo") {
      onMakeChange(raw);
    } else {
      onModelChange(raw);
    }
    setOpen(null);
  };

  const showMiss =
    open &&
    searchQ.trim().length >= 1 &&
    carSuggestions.length === 0 &&
    (open !== "make" || makeSuggestions.length === 0);

  return (
    <div className="vehicle-mm" ref={rootRef}>
      <label className="zn-field zn-field--wide">
        <span>Автомобиль (поиск марка + модель)</span>
        <input
          className="crm-input"
          placeholder="Начните вводить: Toyota, Камри, Freelander…"
          value={comboQ || (make || model ? `${make}${model ? ` ${model}` : ""}` : "")}
          onFocus={() => {
            setOpen("combo");
            setComboQ(make || model ? `${make}${model ? ` ${model}` : ""}` : "");
          }}
          onChange={(e) => {
            const v = e.target.value;
            setComboQ(v);
            setOpen("combo");
            // живое разбиение: первое слово — марка
            const parts = v.trim().split(/\s+/);
            if (parts[0]) onMakeChange(parts[0]);
            if (parts.length > 1) onModelChange(parts.slice(1).join(" "));
            else if (!v.trim()) {
              onMakeChange("");
              onModelChange("");
            }
          }}
          autoComplete="off"
        />
        {open === "combo" && (
          <div className="vehicle-mm__list">
            {carSuggestions.map((s) => (
              <button
                key={s.label}
                type="button"
                className="vehicle-mm__item"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => pick(s)}
              >
                <strong>{s.make}</strong>
                <span>{s.model}</span>
              </button>
            ))}
            {showMiss && (
              <div className="vehicle-mm__miss">
                <p>
                  «{searchQ.trim()}» нет в справочнике — можно оставить как свою марку/модель
                </p>
                <button type="button" className="crm-btn crm-btn-primary" onClick={useCustom}>
                  Использовать «{searchQ.trim()}»
                </button>
              </div>
            )}
            {!searchQ.trim() && carSuggestions.length > 0 && (
              <p className="vehicle-mm__hint">Популярные автомобили</p>
            )}
          </div>
        )}
      </label>

      <label className="zn-field">
        <span>{makeLabel}</span>
        <input
          value={make}
          onChange={(e) => {
            onMakeChange(e.target.value);
            setComboQ("");
            setOpen("make");
          }}
          onFocus={() => setOpen("make")}
          placeholder="Марка"
          autoComplete="off"
        />
        {open === "make" && (
          <div className="vehicle-mm__list">
            {makeSuggestions.map((m) => (
              <button
                key={m}
                type="button"
                className="vehicle-mm__item"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  onMakeChange(m);
                  setOpen("model");
                }}
              >
                <strong>{m}</strong>
              </button>
            ))}
            {carSuggestions.slice(0, 7).map((s) => (
              <button
                key={`c-${s.label}`}
                type="button"
                className="vehicle-mm__item"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => pick(s)}
              >
                <strong>{s.make}</strong>
                <span>{s.model}</span>
              </button>
            ))}
            {make.trim() && makeSuggestions.length === 0 && carSuggestions.length === 0 && (
              <div className="vehicle-mm__miss">
                <p>Марки нет в списке — сохраним как введено</p>
                <button type="button" className="crm-btn" onClick={() => setOpen(null)}>
                  Оставить «{make.trim()}»
                </button>
              </div>
            )}
          </div>
        )}
      </label>

      <label className="zn-field">
        <span>{modelLabel}</span>
        <input
          value={model}
          onChange={(e) => {
            onModelChange(e.target.value);
            setComboQ("");
            setOpen("model");
          }}
          onFocus={() => setOpen("model")}
          placeholder="Модель"
          autoComplete="off"
        />
        {open === "model" && (
          <div className="vehicle-mm__list">
            {carSuggestions.map((s) => (
              <button
                key={s.label}
                type="button"
                className="vehicle-mm__item"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => pick(s)}
              >
                <strong>{s.make}</strong>
                <span>{s.model}</span>
              </button>
            ))}
            {model.trim() && carSuggestions.length === 0 && (
              <div className="vehicle-mm__miss">
                <p>Модели нет в списке — сохраним как введено</p>
                <button type="button" className="crm-btn" onClick={() => setOpen(null)}>
                  Оставить «{model.trim()}»
                </button>
              </div>
            )}
          </div>
        )}
      </label>
    </div>
  );
}
