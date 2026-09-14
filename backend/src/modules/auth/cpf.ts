/** Validação de CPF — dígitos verificadores. Sem dependência externa. */

export const onlyDigits = (value: string): string => value.replace(/\D/g, '');

export function isValidCPF(cpf: string): boolean {
  const digits = onlyDigits(cpf);
  if (digits.length !== 11) return false;
  if (/^(\d)\1{10}$/.test(digits)) return false; // 111.111.111-11 etc.

  const calc = (slice: number): number => {
    let sum = 0;
    for (let i = 0; i < slice; i++) sum += Number(digits[i]) * (slice + 1 - i);
    const rest = (sum * 10) % 11;
    return rest === 10 ? 0 : rest;
  };

  return calc(9) === Number(digits[9]) && calc(10) === Number(digits[10]);
}
