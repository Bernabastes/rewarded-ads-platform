export interface PasswordStrength {
  /** 0 (empty) .. 4 (strong) */
  score: 0 | 1 | 2 | 3 | 4;
  label: string;
  /** Requirements the API enforces: >= 8 chars, a letter and a digit. */
  meetsPolicy: boolean;
  suggestions: string[];
}

export function assessPassword(password: string): PasswordStrength {
  if (!password) return { score: 0, label: 'Enter a password', meetsPolicy: false, suggestions: [] };
  const hasLetter = /[A-Za-z]/.test(password);
  const hasDigit = /\d/.test(password);
  const hasUpperLower = /[a-z]/.test(password) && /[A-Z]/.test(password);
  const hasSymbol = /[^A-Za-z0-9]/.test(password);
  const longEnough = password.length >= 8;
  const long = password.length >= 12;

  let points = 0;
  if (longEnough) points += 1;
  if (hasLetter && hasDigit) points += 1;
  if (hasUpperLower) points += 1;
  if (hasSymbol) points += 1;
  if (long) points += 1;
  // Common weak patterns
  if (/^(.)\1+$/.test(password) || /^(1234|password|qwerty|abcd)/i.test(password))
    points = Math.min(points, 1);

  const score = Math.max(1, Math.min(4, Math.ceil((points / 5) * 4))) as 1 | 2 | 3 | 4;
  const labels: Record<1 | 2 | 3 | 4, string> = { 1: 'Weak', 2: 'Fair', 3: 'Good', 4: 'Strong' };
  const suggestions: string[] = [];
  if (!longEnough) suggestions.push('Use at least 8 characters');
  if (!hasLetter || !hasDigit) suggestions.push('Mix letters and numbers');
  if (!hasUpperLower) suggestions.push('Add upper and lower case');
  if (!hasSymbol) suggestions.push('Add a symbol');
  if (!long) suggestions.push('12+ characters is even better');

  return { score, label: labels[score], meetsPolicy: longEnough && hasLetter && hasDigit, suggestions };
}
