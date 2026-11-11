/** Máscaras e validações dos formulários (espelham o servidor, que é quem decide). */

export const onlyDigits = (value: string) => value.replace(/\D/g, '');

const mask = (digits: string, pattern: string) => {
  let out = '';
  let i = 0;
  for (const char of pattern) {
    if (i >= digits.length) break;
    if (char === '#') out += digits[i++];
    else out += char;
  }
  return out;
};

export const maskCPF = (value: string) => mask(onlyDigits(value).slice(0, 11), '###.###.###-##');
export const maskCEP = (value: string) => mask(onlyDigits(value).slice(0, 8), '#####-###');
export const maskDate = (value: string) => mask(onlyDigits(value).slice(0, 8), '##/##/####');
export const maskPhone = (value: string) => {
  let digits = onlyDigits(value);
  // Colado com o código do país (+55 11 9...): descarta o 55.
  if (digits.length > 11 && digits.startsWith('55')) digits = digits.slice(2);
  digits = digits.slice(0, 11);
  return digits.length > 10 ? mask(digits, '(##) #####-####') : mask(digits, '(##) ####-####');
};

export function isValidCPF(value: string): boolean {
  const digits = onlyDigits(value);
  if (digits.length !== 11 || /^(\d)\1{10}$/.test(digits)) return false;
  const calc = (slice: number) => {
    let sum = 0;
    for (let i = 0; i < slice; i++) sum += Number(digits[i]) * (slice + 1 - i);
    const rest = (sum * 10) % 11;
    return rest === 10 ? 0 : rest;
  };
  return calc(9) === Number(digits[9]) && calc(10) === Number(digits[10]);
}

/** "15/03/1990" → "1990-03-15"; null se a data não existe ou está no futuro. */
export function brDateToISO(value: string): string | null {
  const match = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(value);
  if (!match) return null;
  const [day, month, year] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day ||
    year < 1900 ||
    date > new Date()
  ) {
    return null;
  }
  return `${match[3]}-${match[2]}-${match[1]}`;
}

export const isValidEmail = (value: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
