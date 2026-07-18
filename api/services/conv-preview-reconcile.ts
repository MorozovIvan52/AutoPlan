import { countPreviewDesync, repairConversationPreviews } from "../lib/conv-preview-audit";
import { sendAdvanceAlertTelegram } from "../lib/advance-telegram-alert";

const INTERVAL_MS = 30 * 60 * 1000;
let lastAlertAt = 0;
const ALERT_COOLDOWN_MS = 60 * 60 * 1000;

export function startConvPreviewReconcile() {
  const run = async () => {
    try {
      const before = await countPreviewDesync();
      if (before === 0) return;

      const fixed = await repairConversationPreviews();
      const after = await countPreviewDesync();
      console.log(`[conv-preview] рассинхрон: ${before}, исправлено: ${fixed}, осталось: ${after}`);

      if (after > 0 && Date.now() - lastAlertAt > ALERT_COOLDOWN_MS) {
        lastAlertAt = Date.now();
        const text = `⚠️ CRM: рассинхрон превью диалогов\nОсталось: ${after}\nИсправлено автоматически: ${fixed}\nПроверьте: npm run repair:previews`;
        await sendAdvanceAlertTelegram("CRM: рассинхрон превью", text).catch(() => {});
      }
    } catch (e: any) {
      console.warn("[conv-preview] reconcile:", e.message);
    }
  };

  void run();
  return setInterval(run, INTERVAL_MS);
}
