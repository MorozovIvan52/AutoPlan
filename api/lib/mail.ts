export type MailPayload = {
  to: string;
  subject: string;
  text: string;
  html?: string;
};

const FROM_EMAIL = () =>
  process.env.MAIL_FROM?.trim()
  || process.env.SMTP_USER?.trim()
  || "noreply@crm.local";

export async function sendMail(payload: MailPayload): Promise<boolean> {
  const sendgridKey = process.env.SENDGRID_API_KEY?.trim();
  if (sendgridKey) {
    return sendViaSendGrid(sendgridKey, payload);
  }

  const resendKey = process.env.RESEND_API_KEY?.trim();
  if (resendKey) {
    return sendViaResend(resendKey, payload);
  }

  const smtpHost = process.env.SMTP_HOST?.trim();
  if (smtpHost) {
    return sendViaSmtpRelay(smtpHost, payload);
  }

  console.log(`[mail] (no provider) to=${payload.to} subject=${payload.subject}`);
  return false;
}

async function sendViaSendGrid(apiKey: string, payload: MailPayload): Promise<boolean> {
  const res = await fetch("https://api.sendgrid.com/v3/mail/send", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      personalizations: [{ to: [{ email: payload.to }] }],
      from: { email: FROM_EMAIL() },
      subject: payload.subject,
      content: [
        { type: "text/plain", value: payload.text },
        ...(payload.html ? [{ type: "text/html", value: payload.html }] : []),
      ],
    }),
  });
  if (!res.ok) {
    console.error("[mail] SendGrid error:", res.status, await res.text().catch(() => ""));
    return false;
  }
  return true;
}

async function sendViaResend(apiKey: string, payload: MailPayload): Promise<boolean> {
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: FROM_EMAIL(),
      to: [payload.to],
      subject: payload.subject,
      text: payload.text,
      html: payload.html,
    }),
  });
  if (!res.ok) {
    console.error("[mail] Resend error:", res.status, await res.text().catch(() => ""));
    return false;
  }
  return true;
}

/** Простой SMTP через внешний HTTP-шлюз (Mailgun-style) или лог в dev */
async function sendViaSmtpRelay(host: string, payload: MailPayload): Promise<boolean> {
  const port = Number(process.env.SMTP_PORT || 587);
  const user = process.env.SMTP_USER?.trim();
  const pass = process.env.SMTP_PASSWORD?.trim();
  if (!user || !pass) {
    console.log(`[mail] SMTP configured (${host}:${port}) but no credentials — ${payload.subject}`);
    return false;
  }
  // Без nodemailer: используем SendGrid-совместимый SMTP relay через fetch, если задан SMTP_RELAY_URL
  const relayUrl = process.env.SMTP_RELAY_URL?.trim();
  if (relayUrl) {
    const res = await fetch(relayUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ host, port, user, pass, from: FROM_EMAIL(), ...payload }),
    });
    return res.ok;
  }
  console.log(`[mail] SMTP ${host}:${port} to=${payload.to} subject=${payload.subject}`);
  return true;
}

export async function notifyBillingEvent(opts: {
  to: string;
  tenantName: string;
  event: "trial_ending" | "payment_failed" | "renewal" | "canceled";
  details?: string;
}) {
  const subjects: Record<typeof opts.event, string> = {
    trial_ending: `Пробный период АвтоПлан CRM скоро истекает — ${opts.tenantName}`,
    payment_failed: `Не удалось списать оплату — ${opts.tenantName}`,
    renewal: `Подписка продлена — ${opts.tenantName}`,
    canceled: `Подписка отменена — ${opts.tenantName}`,
  };
  const bodies: Record<typeof opts.event, string> = {
    trial_ending: `Пробный период организации «${opts.tenantName}» скоро закончится. Продлите подписку в разделе «Биллинг».`,
    payment_failed: `Платёж по подписке «${opts.tenantName}» не прошёл. Обновите платёжный метод в Stripe Customer Portal.`,
    renewal: `Подписка «${opts.tenantName}» успешно продлена.`,
    canceled: `Подписка «${opts.tenantName}» отменена.${opts.details ? ` ${opts.details}` : ""}`,
  };
  return sendMail({
    to: opts.to,
    subject: subjects[opts.event],
    text: bodies[opts.event],
  });
}
