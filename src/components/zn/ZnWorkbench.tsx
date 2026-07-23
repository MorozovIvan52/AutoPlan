import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { apiFetch } from "../../lib/fetch-api";
import { useToast } from "../../lib/toast";
import { dealStatusLabel, formatFullTime } from "../../lib/utils";
import { useOpenTabs } from "../../lib/open-tabs";
import type {
  ClientPayload,
  DealPayload,
  InspectionReportData,
  LaborRow,
  PartRow,
  TabId,
} from "./zn-types";
import { money, parseInspection } from "./zn-types";
import { ZnInfoTab } from "./ZnInfoTab";
import { ZnLaborTab } from "./ZnLaborTab";
import { ZnPartsTab } from "./ZnPartsTab";
import { ZnInspectionTab } from "./ZnInspectionTab";
import { ZnAdditionalTab } from "./ZnAdditionalTab";
import { ZnStsFillModal } from "./ZnStsFillModal";
import { ZnPrintReports } from "./ZnPrintReports";

export function ZnWorkbench({ dealId }: { dealId: number }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [, setLocation] = useLocation();
  const { openTab } = useOpenTabs();
  const [tab, setTab] = useState<TabId>("info");
  const [stsOpen, setStsOpen] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const [title, setTitle] = useState("");
  const [status, setStatus] = useState("new");
  const [description, setDescription] = useState("");
  const [woNote, setWoNote] = useState("");
  const [vin, setVin] = useState("");
  const [plate, setPlate] = useState("");
  const [make, setMake] = useState("");
  const [model, setModel] = useState("");
  const [year, setYear] = useState("");
  const [mileage, setMileage] = useState("");
  const [campaign, setCampaign] = useState("");
  const [warranty, setWarranty] = useState("");
  const [contractTerms, setContractTerms] = useState("");
  const [inspection, setInspection] = useState<InspectionReportData>(() => parseInspection(null, null));

  const { data, isLoading } = useQuery({
    queryKey: ["deal", dealId],
    queryFn: () =>
      apiFetch<{
        deal: DealPayload;
        client: ClientPayload | null;
        items: PartRow[];
        assignee: { id: number; name: string } | null;
      }>(`/api/deals/${dealId}`),
  });

  const { data: laborData, refetch: refetchLabor } = useQuery({
    queryKey: ["zn-labor", dealId],
    queryFn: () => apiFetch<{ items: LaborRow[] }>(`/api/orders/${dealId}/labor`),
  });

  const { data: partsData, refetch: refetchParts } = useQuery({
    queryKey: ["zn-parts", dealId],
    queryFn: () => apiFetch<{ items: PartRow[] }>(`/api/orders/${dealId}/items`),
  });

  useEffect(() => {
    const d = data?.deal;
    if (!d) return;
    setTitle(d.title || "");
    setStatus(d.status || "new");
    setDescription(d.description || "");
    setWoNote(d.woNote || "");
    setVin(d.vin || "");
    setPlate(d.vehiclePlate || "");
    setMake(d.vehicleMake || "");
    setModel(d.vehicleModel || "");
    setYear(d.vehicleYear != null ? String(d.vehicleYear) : "");
    setMileage(d.mileage != null ? String(d.mileage) : "");
    setCampaign(d.campaign || "");
    setWarranty(d.warrantyObligations || "");
    setContractTerms(d.contractTerms || "");
    setInspection(parseInspection(d.inspectionReport, d.mileage ?? null));
    openTab(`/zn/${dealId}`, `ЗН № ${dealId}`);
  }, [data?.deal, dealId, openTab]);

  const labor = laborData?.items || [];
  const parts = partsData?.items || data?.items || [];
  const laborSum = labor.reduce((s, x) => s + (Number(x.price) || 0), 0);
  const partsSum = parts.reduce(
    (s, x) => s + (Number(x.price) || 0) * (Number(x.qty) || 1),
    0,
  );
  const total = laborSum + partsSum;
  const paid = Number(data?.deal?.paidAmount) || 0;
  const balance = Math.max(0, total - paid);

  const buildPatchBody = () => {
    const mileageNum = mileage.trim() ? Number(mileage.replace(/\s/g, "")) : null;
    const yearNum = year.trim() ? Number(year) : null;
    const insp: InspectionReportData = {
      ...inspection,
      mileage: mileageNum ?? inspection.mileage,
    };
    return {
      title: title.trim(),
      status,
      description: description.trim() || null,
      woNote: woNote.trim() || null,
      vin: vin.trim() || null,
      vehiclePlate: plate.trim() || null,
      vehicleMake: make.trim() || null,
      vehicleModel: model.trim() || null,
      vehicleYear: yearNum && Number.isFinite(yearNum) ? yearNum : null,
      mileage: mileageNum != null && Number.isFinite(mileageNum) ? mileageNum : null,
      campaign: campaign.trim() || null,
      warrantyObligations: warranty.trim() || null,
      contractTerms: contractTerms.trim() || null,
      inspectionReport: JSON.stringify(insp),
      amount: total,
    };
  };

  const validateForClose = () => {
    const errors: Record<string, string> = {};
    if (!data?.client?.id) errors.client = "Укажите клиента";
    if (!title.trim()) errors.title = "Обязательное поле";
    if (!mileage.trim()) errors.mileage = "Укажите пробег";
    if (!campaign.trim()) errors.campaign = "Обязательное поле";
    setFieldErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const saveInfo = useMutation({
    mutationFn: () =>
      apiFetch(`/api/deals/${dealId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(buildPatchBody()),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["deal", dealId] });
      qc.invalidateQueries({ queryKey: ["zn-list"] });
      toast("ЗН сохранён", "success");
      setFieldErrors({});
    },
    onError: (e: Error) => toast(e.message, "error"),
  });

  const closePay = useMutation({
    mutationFn: async () => {
      if (!validateForClose()) {
        setTab("info");
        throw new Error("Заполните обязательные поля на вкладке Инфо");
      }
      await apiFetch(`/api/deals/${dealId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(buildPatchBody()),
      });
      return apiFetch(`/api/sto/deals/${dealId}/close-with-payment`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          paymentAmount: balance > 0 ? balance : total,
          paymentMethod: "cash",
          setStatusDone: true,
          allowPartial: true,
        }),
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["deal", dealId] });
      qc.invalidateQueries({ queryKey: ["zn-list"] });
      toast("ЗН проведён", "success");
    },
    onError: (e: Error) => toast(e.message, "error"),
  });

  const tabs = useMemo(
    () =>
      [
        { id: "info" as const, label: "Инфо" },
        { id: "labor" as const, label: `Работы${labor.length ? ` (${labor.length})` : ""}` },
        { id: "parts" as const, label: `Товары${parts.length ? ` (${parts.length})` : ""}` },
        { id: "inspection" as const, label: "Акт осмотра" },
        { id: "additional" as const, label: "Дополнительно" },
      ] as const,
    [labor.length, parts.length],
  );

  const vehicleLabel = [make, model, year].filter(Boolean).join(" ");

  if (isLoading) return <div className="zn-workbench zn-workbench--loading">Загрузка ЗН…</div>;
  if (!data?.deal) return <div className="zn-workbench">ЗН не найден</div>;

  return (
    <div className="zn-workbench">
      <div className="zn-wb-toolbar">
        <div className="zn-wb-toolbar__left">
          <button
            type="button"
            className="crm-btn crm-btn-primary"
            onClick={() => saveInfo.mutate()}
            disabled={saveInfo.isPending}
          >
            Сохранить
          </button>
          <button
            type="button"
            className="crm-btn"
            onClick={() => closePay.mutate()}
            disabled={closePay.isPending}
          >
            Провести и закрыть
          </button>
        </div>
        <div className="zn-wb-toolbar__right">
          <button type="button" className="crm-btn crm-btn-ghost" onClick={() => setLocation("/zn")}>
            ← К списку
          </button>
        </div>
      </div>

      <ZnPrintReports
        dealId={dealId}
        title={title}
        client={data?.client || null}
        vehicle={vehicleLabel}
        vin={vin}
        plate={plate}
        mileage={mileage}
        labor={labor}
        parts={parts}
        total={total}
        paid={paid}
        balance={balance}
      />

      <div className="zn-wb-header">
        <div>
          <h1 className="zn-wb-title">Заказ-наряд № {dealId}</h1>
          <div className="zn-wb-meta">
            <span className="zn-badge">{dealStatusLabel(status)}</span>
            <span className="zn-muted">
              обновлён {formatFullTime(data.deal.updatedAt || data.deal.createdAt)}
            </span>
          </div>
        </div>
        <div className="zn-wb-total">
          <div className="zn-wb-total__label">Итого</div>
          <div className="zn-wb-total__value">{money(total)}</div>
          <div className="zn-muted">
            Оплачено {money(paid)} · долг {money(balance)}
          </div>
        </div>
      </div>

      <div className="zn-wb-tabs" role="tablist">
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            className={`zn-wb-tab${tab === t.id ? " is-active" : ""}`}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="zn-wb-body">
        {tab === "info" && (
          <ZnInfoTab
            client={data.client}
            assigneeName={data.assignee?.name || ""}
            title={title}
            setTitle={setTitle}
            status={status}
            setStatus={setStatus}
            description={description}
            setDescription={setDescription}
            woNote={woNote}
            setWoNote={setWoNote}
            vin={vin}
            setVin={setVin}
            plate={plate}
            setPlate={setPlate}
            make={make}
            setMake={setMake}
            model={model}
            setModel={setModel}
            year={year}
            setYear={setYear}
            mileage={mileage}
            setMileage={setMileage}
            campaign={campaign}
            setCampaign={setCampaign}
            fieldErrors={fieldErrors}
            onOpenSts={() => setStsOpen(true)}
          />
        )}
        {tab === "labor" && (
          <ZnLaborTab
            dealId={dealId}
            labor={labor}
            onChanged={() => {
              refetchLabor();
              qc.invalidateQueries({ queryKey: ["deal", dealId] });
            }}
          />
        )}
        {tab === "parts" && (
          <ZnPartsTab
            dealId={dealId}
            parts={parts}
            onChanged={() => {
              refetchParts();
              qc.invalidateQueries({ queryKey: ["deal", dealId] });
            }}
          />
        )}
        {tab === "inspection" && (
          <ZnInspectionTab
            value={inspection}
            onChange={(next) => {
              setInspection(next);
              if (next.mileage != null) setMileage(String(next.mileage));
            }}
          />
        )}
        {tab === "additional" && (
          <ZnAdditionalTab
            warranty={warranty}
            setWarranty={setWarranty}
            contractTerms={contractTerms}
            setContractTerms={setContractTerms}
          />
        )}
      </div>

      <ZnStsFillModal
        open={stsOpen}
        onClose={() => setStsOpen(false)}
        onApply={(parsed) => {
          if (parsed.vin) setVin(parsed.vin);
          if (parsed.displayPlate || parsed.plate) setPlate(parsed.displayPlate || parsed.plate || "");
          if (parsed.make) setMake(parsed.make);
          if (parsed.model) setModel(parsed.model);
          if (parsed.year) setYear(String(parsed.year));
          if (parsed.ownerName && !title.trim()) {
            setTitle(`ЗН · ${parsed.ownerName}`);
          }
          setTab("info");
        }}
      />
    </div>
  );
}
