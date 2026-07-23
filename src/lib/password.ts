/** Клиентская проверка пароля (синхронно с api/lib/password.ts). */
export function validatePassword(password: string, email?: string, minLength = 10): string | null {
  if (!password || password.length < minLength) return `Пароль не менее ${minLength} символов`;
  if (password.length > 128) return "Пароль слишком длинный";
  if (!/[a-zA-Zа-яА-ЯёЁ]/.test(password) || !/\d/.test(password)) {
    return "Пароль должен содержать букву и цифру";
  }
  const normalizedEmail = email?.trim().toLowerCase();
  if (normalizedEmail && password.toLowerCase() === normalizedEmail) {
    return "Пароль не должен совпадать с email";
  }
  return null;
}

export async function fetchPasswordPolicy(): Promise<{ minLength: number; requireLetterAndDigit: boolean }> {
  try {
    const res = await fetch("/api/auth/password-policy");
    if (!res.ok) return { minLength: 10, requireLetterAndDigit: true };
    return await res.json();
  } catch {
    return { minLength: 10, requireLetterAndDigit: true };
  }
}
