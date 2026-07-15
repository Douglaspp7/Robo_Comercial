import { z } from 'zod';

export const signupSchema = z.object({
  email: z.string().email().max(254).toLowerCase().trim(),
  password: z.string().min(8).max(128),
  // Aceite obrigatório dos Termos de Uso / Política de Privacidade — validação
  // aqui é o que garante que nenhuma conta é criada sem o aceite registrado
  // (ver auth.js createTenant / tenants.terms_accepted_at).
  accept_terms: z.literal(true, {
    error: 'É necessário aceitar os Termos de Uso e a Política de Privacidade.',
  }),
});

export const loginSchema = z.object({
  email: z.string().email().max(254).toLowerCase().trim(),
  password: z.string().min(1).max(128),
});

export const forgotPasswordSchema = z.object({
  email: z.string().email().max(254).toLowerCase().trim(),
});

export const resetPasswordSchema = z.object({
  // Token cru vindo do link do e-mail (64 hex). Aceita mais para mensagens
  // de erro serem "token inválido" (o real validador é auth.consumePasswordResetToken).
  token: z.string().min(16).max(256),
  password: z.string().min(8).max(128),
});

export const settingsSchema = z.object({
  business_name: z.string().max(200).optional(),
  atendente_name: z.string().max(100).optional(),
  checkout_url: z.string().url().max(500).optional().or(z.literal('')),
  cep_origem: z.string().regex(/^\d{8}$/).optional().or(z.literal('')),
  mp_access_token: z.string().max(500).optional().or(z.literal('')),
  melhor_envio_token: z.string().max(500).optional().or(z.literal('')),
  business_json: z.string().max(50000).optional(), // JSON string
}).strip();

export function validate(schema, data) {
  const result = schema.safeParse(data);
  if (!result.success) {
    // Zod v4 renomeou ZodError.errors para .issues — .errors não existe mais
    // e sempre seria undefined aqui, quebrando a mensagem de validação.
    const messages = result.error.issues.map((e) => e.message).join(', ');
    const err = new Error(messages);
    err.statusCode = 400;
    err.validation = true;
    throw err;
  }
  return result.data;
}
