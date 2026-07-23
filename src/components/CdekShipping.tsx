import { useState, useEffect, useMemo, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "../lib/fetch-api";
import { useToast } from "../lib/toast";
type Props = { dealId: number; deal: any; client: any; items: any[] };
function defaultProductName(deal: any, items: any[]) {
  if (deal.cdekProductName) return String(deal.cdekProductName);
  if (items.length === 1) return String(items[0]?.name || deal.title || "");
  if (items.length > 1) {
    const joined = items
      .map((i) => i?.name)
      .filter(Boolean)
      .join(", ")
      .slice(0, 200);
    return joined || String(deal.title || "");
  }
  return String(deal.title || "");
}
export function CdekShipping({ dealId, deal, client, items }: Props) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [cityQuery, setCityQuery] = useState("");
  const [cityCode, setCityCode] = useState<number | "">(
    deal.cdekCityCode || "",
  );
  const [pvzCode, setPvzCode] = useState(deal.cdekPvzCode || "");
  const [pvzAddress, setPvzAddress] = useState(deal.cdekPvzAddress || "");
  const [tariffCode, setTariffCode] = useState<number | "">(
    deal.cdekTariffCode || "",
  );
  const [imNumber, setImNumber] = useState(
    deal.cdekImNumber || deal.title || "",
  );
  const [productName, setProductName] = useState(() =>
    defaultProductName(deal, items),
  );
  const [weightKg, setWeightKg] = useState(
    deal.cdekPackageWeight ? String(deal.cdekPackageWeight / 1000) : "1",
  );
  const [lengthCm, setLengthCm] = useState(
    String(deal.cdekPackageLength || "30"),
  );
  const [widthCm, setWidthCm] = useState(String(deal.cdekPackageWidth || "20"));
  const [heightCm, setHeightCm] = useState(
    String(deal.cdekPackageHeight || "15"),
  );
  const [goodsPayment, setGoodsPayment] = useState(
    String(deal.cdekGoodsPayment ?? deal.amount ?? ""),
  );
  const [goodsFromRecipient, setGoodsFromRecipient] = useState(true);
  const [deliveryFromRecipient, setDeliveryFromRecipient] = useState(true);
  const [deliveryRecipientCost, setDeliveryRecipientCost] = useState("");
  const deliveryCostTouched = useRef(false);
  const weightGrams = useMemo(() => {
    const kg = parseFloat(String(weightKg).replace(",", "."));
    return Number.isFinite(kg) && kg > 0 ? Math.round(kg * 1000) : 0;
  }, [weightKg]);
  const { data: status, isLoading: statusLoading } = useQuery({
    queryKey: ["cdek-status"],
    queryFn: () =>
      apiFetch<{ configured: boolean; enabled: boolean }>("/api/cdek/status"),
    staleTime: 60000,
  });
  const { data: citiesData } = useQuery({
    queryKey: ["cdek-cities", cityQuery],
    queryFn: () =>
      apiFetch<{ cities: { code: number; city: string; region?: string }[] }>(
        `/api/cdek/cities?q=${encodeURIComponent(cityQuery)}`,
      ),
    enabled: cityQuery.length >= 2 && !!status?.configured,
  });
  const { data: pvzData } = useQuery({
    queryKey: ["cdek-pvz", cityCode],
    queryFn: () =>
      apiFetch<{ pvz: { code: string; name: string; address: string }[] }>(
        `/api/cdek/pvz?cityCode=${cityCode}`,
      ),
    enabled: !!cityCode && !!status?.configured,
  });
  const dims = useMemo(
    () => ({
      length: parseInt(lengthCm) || 0,
      width: parseInt(widthCm) || 0,
      height: parseInt(heightCm) || 0,
    }),
    [lengthCm, widthCm, heightCm],
  );
  const {
    data: tariffsData,
    refetch: refetchTariffs,
    isFetching: tariffsLoading,
  } = useQuery({
    queryKey: [
      "cdek-tariffs",
      dealId,
      cityCode,
      weightGrams,
      dims.length,
      dims.width,
      dims.height,
    ],
    queryFn: () =>
      apiFetch<{
        tariffs: {
          tariff_code: number;
          tariff_name: string;
          delivery_sum: number;
          period_min: number;
          period_max: number;
        }[];
      }>("/api/cdek/calculate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          toCityCode: cityCode,
          weight: weightGrams,
          length: dims.length,
          width: dims.width,
          height: dims.height,
        }),
      }),
    enabled: false,
  });
  const selectedTariff = tariffsData?.tariffs?.find(
    (t) => t.tariff_code === tariffCode,
  );
  const deliveryBase = selectedTariff?.delivery_sum ?? 0;
  const deliveryWithMarkup = Math.round(deliveryBase * 2);
  useEffect(() => {
    if (
      cityCode &&
      weightGrams >= 100 &&
      dims.length &&
      dims.width &&
      dims.height &&
      status?.configured
    ) {
      refetchTariffs();
    }
  }, [
    cityCode,
    weightGrams,
    dims.length,
    dims.width,
    dims.height,
    status?.configured,
  ]);
  useEffect(() => {
    // Only auto-pick when empty string — avoid infinite loop on falsy 0/undefined codes
    if (tariffCode !== "" || !tariffsData?.tariffs?.length) return;
    const preferred =
      tariffsData.tariffs.find((t) => t.tariff_code === 136) ||
      tariffsData.tariffs[0];
    const code = preferred?.tariff_code;
    if (typeof code === "number" && Number.isFinite(code)) {
      setTariffCode(code);
    }
  }, [tariffsData, tariffCode]);
  useEffect(() => {
    if (
      deliveryBase > 0 &&
      deliveryFromRecipient &&
      !deliveryCostTouched.current
    ) {
      setDeliveryRecipientCost(String(deliveryWithMarkup));
    }
  }, [deliveryBase, deliveryWithMarkup, deliveryFromRecipient]);
  const shipMutation = useMutation({
    mutationFn: () =>
      apiFetch(`/api/cdek/deals/${dealId}/ship`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          imNumber: String(imNumber).trim(),
          productName: String(productName).trim(),
          weightGrams,
          lengthCm: dims.length,
          widthCm: dims.width,
          heightCm: dims.height,
          goodsPayment: parseFloat(String(goodsPayment).replace(",", ".")) || 0,
          goodsPaymentFromRecipient: goodsFromRecipient,
          deliveryFromRecipient,
          deliveryBaseCost: deliveryBase,
          deliveryRecipientCost:
            parseFloat(String(deliveryRecipientCost).replace(",", ".")) ||
            deliveryWithMarkup,
          deliveryPoint: pvzCode,
          pvzAddress,
          cityCode: cityCode ? Number(cityCode) : null,
          tariffCode: tariffCode ? Number(tariffCode) : null,
        }),
      }),
    onSuccess: (res: any) => {
      qc.invalidateQueries({ queryKey: ["deal", dealId] });
      qc.invalidateQueries({ queryKey: ["deals-all"] });
      const track = res?.cdek?.trackNumber;
      toast(
        track
          ? `Накладная создана · Трек: ${track}`
          : "Заявка в СДЭК создана — трек появится через минуту",
        "success",
      );
    },
    onError: (e: Error) => toast(e.message, "error"),
  });
  const trackMutation = useMutation({
    mutationFn: () =>
      apiFetch<{ trackNumber?: string; status?: string }>(
        `/api/cdek/deals/${dealId}/track`,
      ),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ["deal", dealId] });
      toast(
        res.trackNumber
          ? `Трек: ${res.trackNumber} · ${res.status}`
          : `Статус: ${res.status || "ожидание"}`,
        "info",
      );
    },
    onError: (e: Error) => toast(e.message, "error"),
  });
  if (statusLoading) {
    return (
      <div className="deal-detail-block">
        <div style={{ fontSize: 11, color: "var(--text-muted)" }}>
          Доставка СДЭК — загрузка…
        </div>
      </div>
    );
  }
  if (!status?.configured) {
    return (
      <div className="deal-detail-block">
        <div
          style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 4 }}
        >
          Доставка СДЭК
        </div>
        <p style={{ fontSize: 12, color: "var(--text-muted)" }}>
          Не настроено — <strong>Настройки → СДЭК</strong>
        </p>
      </div>
    );
  }
  if (deal.cdekOrderUuid || deal.cdekTrackNumber) {
    return (
      <div className="deal-detail-block">
        <div
          style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 6 }}
        >
          Доставка СДЭК
        </div>
        {deal.cdekImNumber && (
          <p style={{ fontSize: 12 }}>
            № ИМ: <strong>{deal.cdekImNumber}</strong>
          </p>
        )}
        {deal.cdekProductName && (
          <p style={{ fontSize: 12, marginTop: 4 }}>
            Товар: {deal.cdekProductName}
          </p>
        )}
        {deal.cdekTrackNumber && (
          <p
            style={{
              fontSize: 14,
              fontWeight: 700,
              color: "var(--accent)",
              marginTop: 6,
            }}
          >
            Трек: {deal.cdekTrackNumber}
          </p>
        )}
        {deal.cdekStatus && (
          <p style={{ fontSize: 12, marginTop: 4 }}>
            Статус: {deal.cdekStatus}
          </p>
        )}
        {deal.cdekPackageWeight && (
          <p style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 4 }}>
            Вес: {(deal.cdekPackageWeight / 1000).toFixed(2)} кг ·{" "}
            {deal.cdekPackageLength}×{deal.cdekPackageWidth}×
            {deal.cdekPackageHeight} см
          </p>
        )}
        {deal.cdekGoodsPayment > 0 && (
          <p style={{ fontSize: 12, marginTop: 4 }}>
            С получателя (товар):{" "}
            {Number(deal.cdekGoodsPayment).toLocaleString("ru-RU")} ₽
          </p>
        )}
        {deal.cdekDeliveryRecipient > 0 && (
          <p style={{ fontSize: 12 }}>
            С получателя (доставка +100%):{" "}
            {Number(deal.cdekDeliveryRecipient).toLocaleString("ru-RU")} ₽
          </p>
        )}
        {deal.cdekPvzAddress && (
          <p style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 4 }}>
            ПВЗ: {deal.cdekPvzAddress}
          </p>
        )}
        <div
          style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap" }}
        >
          <button
            type="button"
            className="crm-btn crm-btn-ghost crm-btn-sm"
            onClick={() => trackMutation.mutate()}
            disabled={trackMutation.isPending}
          >
            Обновить статус
          </button>
          {deal.cdekTrackNumber && (
            <a
              href={`https://www.cdek.ru/ru/tracking?order_id=${deal.cdekTrackNumber}`}
              target="_blank"
              rel="noreferrer"
              className="crm-btn crm-btn-ghost crm-btn-sm"
            >
              Отследить на cdek.ru
            </a>
          )}
        </div>
      </div>
    );
  }
  const canShip =
    pvzCode &&
    client?.phone &&
    String(productName || "").trim() &&
    String(imNumber || "").trim() &&
    weightGrams >= 100 &&
    dims.length &&
    dims.width &&
    dims.height &&
    tariffCode !== "" &&
    typeof tariffCode === "number";
  return (
    <div className="deal-detail-block">
      <div
        style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 8 }}
      >
        Отправка СДЭК — заполняет менеджер
      </div>
      <label className="deal-field">
        <span>№ отправления ИМ (название заказа)</span>
        <input
          className="crm-input"
          value={imNumber}
          onChange={(e) => setImNumber(e.target.value)}
          placeholder="Как в заказе"
        />
      </label>
      <label className="deal-field">
        <span>Наименование товара в СДЭК *</span>
        <input
          className="crm-input"
          value={productName}
          onChange={(e) => setProductName(e.target.value)}
          placeholder="Напр. Колодки тормозные Bosch"
        />
      </label>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
        <label className="deal-field">
          <span>Вес, кг *</span>
          <input
            className="crm-input"
            type="number"
            min="0.1"
            step="0.1"
            value={weightKg}
            onChange={(e) => setWeightKg(e.target.value)}
          />
        </label>
        <label className="deal-field">
          <span>Длина, см *</span>
          <input
            className="crm-input"
            type="number"
            min="1"
            value={lengthCm}
            onChange={(e) => setLengthCm(e.target.value)}
          />
        </label>
        <label className="deal-field">
          <span>Ширина, см *</span>
          <input
            className="crm-input"
            type="number"
            min="1"
            value={widthCm}
            onChange={(e) => setWidthCm(e.target.value)}
          />
        </label>
        <label className="deal-field">
          <span>Высота, см *</span>
          <input
            className="crm-input"
            type="number"
            min="1"
            value={heightCm}
            onChange={(e) => setHeightCm(e.target.value)}
          />
        </label>
      </div>
      <label className="deal-field">
        <span>Город получателя</span>
        <input
          className="crm-input"
          placeholder="Начните вводить город..."
          value={cityQuery}
          onChange={(e) => setCityQuery(e.target.value)}
        />
        {(citiesData?.cities || []).length > 0 &&
          cityQuery.length >= 2 &&
          !cityCode && (
            <div
              style={{
                marginTop: 4,
                maxHeight: 120,
                overflowY: "auto",
                border: "1px solid var(--border)",
                borderRadius: 8,
              }}
            >
              {citiesData!.cities.map((c) => (
                <button
                  key={c.code}
                  type="button"
                  style={{
                    display: "block",
                    width: "100%",
                    textAlign: "left",
                    padding: "8px 10px",
                    border: "none",
                    background:
                      cityCode === c.code ? "var(--accent-soft)" : "transparent",
                    cursor: "pointer",
                    fontSize: 12,
                  }}
                  onClick={() => {
                    setCityCode(c.code);
                    setCityQuery(`${c.city}${c.region ? `, ${c.region}` : ""}`);
                    setPvzCode("");
                  }}
                >
                  {c.city}
                  {c.region ? `, ${c.region}` : ""}
                </button>
              ))}
            </div>
          )}
      </label>
      {cityCode && (
        <label className="deal-field">
          <span>Пункт выдачи</span>
          <select
            className="crm-input"
            value={pvzCode}
            onChange={(e) => {
              setPvzCode(e.target.value);
              const p = pvzData?.pvz?.find((x) => x.code === e.target.value);
              if (p) setPvzAddress(p.address);
            }}
          >
            <option value="">Выберите ПВЗ...</option>
            {(pvzData?.pvz || []).map((p) => (
              <option key={p.code} value={p.code}>
                {p.address || p.name}
              </option>
            ))}
          </select>
        </label>
      )}
      {tariffsLoading && (
        <p style={{ fontSize: 11, color: "var(--text-muted)" }}>
          Расчёт тарифов...
        </p>
      )}
      {tariffsData?.tariffs && tariffsData.tariffs.length > 0 && (
        <label className="deal-field">
          <span>Тариф СДЭК</span>
          <select
            className="crm-input"
            value={tariffCode}
            onChange={(e) => setTariffCode(Number(e.target.value))}
          >
            {tariffsData.tariffs.map((t) => (
              <option key={t.tariff_code} value={t.tariff_code}>
                {t.tariff_name} — база {t.delivery_sum} ₽ ({t.period_min}–
                {t.period_max} дн.)
              </option>
            ))}
          </select>
        </label>
      )}
      <div
        style={{
          borderTop: "1px solid var(--border)",
          paddingTop: 10,
          marginTop: 4,
          display: "flex",
          flexDirection: "column",
          gap: 8,
        }}
      >
        <p style={{ fontSize: 12, fontWeight: 600 }}>Оплата с получателя</p>
        <label className="deal-field">
          <span>Сумма за товар, ₽</span>
          <input
            className="crm-input"
            type="number"
            min="0"
            value={goodsPayment}
            onChange={(e) => setGoodsPayment(e.target.value)}
          />
        </label>
        <label
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            fontSize: 12,
            cursor: "pointer",
          }}
        >
          <input
            type="checkbox"
            checked={goodsFromRecipient}
            onChange={(e) => setGoodsFromRecipient(e.target.checked)}
          />
          Оплата товара с получателя (наложенный платёж)
        </label>
        {deliveryBase > 0 && (
          <p style={{ fontSize: 11, color: "var(--text-muted)" }}>
            Базовая доставка СДЭК: {deliveryBase} ₽ → с наценкой 100% (без НДС):{" "}
            <strong>{deliveryWithMarkup} ₽</strong>
          </p>
        )}
        <label
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            fontSize: 12,
            cursor: "pointer",
          }}
        >
          <input
            type="checkbox"
            checked={deliveryFromRecipient}
            onChange={(e) => setDeliveryFromRecipient(e.target.checked)}
          />
          Доставка с получателя (наценка 100%, без НДС)
        </label>
        {deliveryFromRecipient && (
          <label className="deal-field">
            <span>Сумма доставки с получателя, ₽</span>
            <input
              className="crm-input"
              type="number"
              min="0"
              value={deliveryRecipientCost}
              onChange={(e) => {
                deliveryCostTouched.current = true;
                setDeliveryRecipientCost(e.target.value);
              }}
            />
          </label>
        )}
      </div>
      {!client?.phone && (
        <p style={{ fontSize: 11, color: "var(--danger)", marginTop: 8 }}>
          У клиента нет телефона — добавьте в карточке клиента
        </p>
      )}
      <button
        type="button"
        className="crm-btn crm-btn-sm"
        style={{ marginTop: 10 }}
        disabled={!canShip || shipMutation.isPending}
        onClick={() => shipMutation.mutate()}
      >
        {shipMutation.isPending
          ? "Создание накладной..."
          : "Создать накладную в СДЭК"}
      </button>
    </div>
  );
}
