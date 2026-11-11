import { z } from 'zod';
import { optionalBirthDate } from '../../lib/br-date.js';
import { isValidCPF, onlyDigits } from './cpf.js';

/**
 * Cadastro (2.1) — * = obrigatório no requisito.
 *
 * Toda mensagem diz QUAL campo está errado: o app mostra a primeira delas.
 * Campos opcionais aceitam string vazia (o app manda o que estiver na tela).
 */

const emptyToUndefined = (value: unknown) =>
  typeof value === 'string' && value.trim() === '' ? undefined : value;

const required = (message: string, min: number, max: number) =>
  z
    .string({ required_error: message, invalid_type_error: message })
    .trim()
    .min(min, message)
    .max(max, message);

export const signUpSchema = z.object({
  fullName: required('Informe seu nome completo.', 3, 160), // *
  cpf: z
    .string({ required_error: 'Informe o CPF.' })
    .transform(onlyDigits)
    .refine(isValidCPF, 'CPF inválido. Confira os números.'), // *
  email: z
    .string({ required_error: 'Informe o e-mail.' })
    .trim()
    .toLowerCase()
    .email('E-mail inválido.')
    .max(160, 'E-mail inválido.'), // *
  phone: z
    .string({ required_error: 'Informe o celular.' })
    .transform(onlyDigits)
    .pipe(
      z
        .string()
        .min(10, 'Celular inválido. Informe DDD + número.')
        .max(13, 'Celular inválido. Informe DDD + número.'),
    ), // *
  password: z
    .string({ required_error: 'Crie uma senha.' })
    .min(8, 'A senha precisa ter pelo menos 8 caracteres.')
    .max(128, 'Senha longa demais.'),
  birthDate: optionalBirthDate,
  instagram: z.preprocess(
    emptyToUndefined,
    z
      .string()
      .trim()
      .transform((v) => v.replace(/^@/, ''))
      .pipe(z.string().max(60, 'Instagram longo demais.'))
      .optional(),
  ),
  gender: z.preprocess(
    emptyToUndefined,
    z
      .enum(['FEMININO', 'MASCULINO', 'NAO_BINARIO', 'OUTRO', 'PREFIRO_NAO_INFORMAR'])
      .optional(),
  ),
  address: z.object(
    {
      // * endereço é obrigatório no cadastro
      zipCode: z
        .string({ required_error: 'Informe o CEP.' })
        .transform(onlyDigits)
        .pipe(z.string().length(8, 'CEP inválido. Use os 8 números.')),
      street: required('Informe a rua.', 3, 160),
      number: z.string().trim().max(20, 'Número longo demais.').default(''),
      complement: z.preprocess(
        emptyToUndefined,
        z.string().trim().max(80, 'Complemento longo demais.').optional(),
      ),
      district: required('Informe o bairro.', 2, 80),
      city: required('Informe a cidade.', 2, 80),
      state: z
        .string({ required_error: 'Informe a UF.' })
        .trim()
        .toUpperCase()
        .regex(/^[A-Z]{2}$/, 'UF inválida. Use a sigla com 2 letras (ex.: SP).'),
    },
    { required_error: 'Informe o endereço.' },
  ),
  acceptedTerms: z.literal(true, { errorMap: () => ({ message: 'É preciso aceitar os termos.' }) }),
});

export type SignUpInput = z.infer<typeof signUpSchema>;
