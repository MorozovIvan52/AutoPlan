// Заглушка для интеграции телефонии / SIP провайдеров (Mango, Novofon)

export type CallRecord = {
  id: string;
  from: string;
  to: string;
  startedAt: string;
  durationSec?: number;
  recordingUrl?: string;
};

export async function sendCallToProvider(provider: string, payload: any): Promise<any> {
  // provider: 'mango' | 'novofon' | 'custom'
  // TODO: реализовать конкретные адаптеры
  return { status: 'ok', provider };
}

export async function fetchCallRecords(tenantId: string): Promise<CallRecord[]> {
  // TODO: хранить записи в `messages` или `call_records` таблице
  return [];
}
