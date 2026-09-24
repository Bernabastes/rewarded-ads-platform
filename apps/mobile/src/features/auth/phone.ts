import { normalizeEthiopianPhone } from '@rap/shared';

/** Accepts "9xxxxxxxx", "09xxxxxxxx", "+2519xxxxxxxx" (with spaces/dashes) and returns E.164 or null. */
export function toE164(localInput: string): string | null {
  const digits = localInput.replace(/\D/g, '');
  if (!digits) return null;
  if (digits.length === 9) return normalizeEthiopianPhone(`0${digits}`);
  return normalizeEthiopianPhone(digits.startsWith('251') ? `+${digits}` : digits);
}

/** "+251911000000" -> "+251 911 000 000" for display. */
export function formatPhoneForDisplay(e164: string): string {
  const m = /^\+251(\d{3})(\d{3})(\d{3})$/.exec(e164);
  return m ? `+251 ${m[1]} ${m[2]} ${m[3]}` : e164;
}
