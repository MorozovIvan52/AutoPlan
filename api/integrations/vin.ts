// Заглушка интеграции по VIN / каталогу запчастей
import fetch from 'node-fetch';

export async function lookupVehicleByVIN(vin: string) {
  // TODO: заменить на реальный провайдер (TecDoc, Autodata, др.)
  if (!vin) return null;
  // пример ответа
  return {
    vin,
    make: 'Toyota',
    model: 'Camry',
    year: 2018,
  };
}

export async function searchParts(query: string) {
  // TODO: подключить каталог поставщиков
  return [{ partId: 'P-123', name: 'Brake pad', price: 1200 }];
}
