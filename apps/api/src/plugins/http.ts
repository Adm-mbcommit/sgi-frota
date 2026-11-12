import type { FastifyReply, FastifyRequest } from 'fastify';
import { z, ZodError, type ZodTypeAny } from 'zod';

export class HttpError extends Error {
  constructor(public status: number, public code: string, message: string) { super(message); }
}
export const notFound = (what = 'Registro') => new HttpError(404, 'not_found', `${what} não encontrado.`);

export function parse<S extends ZodTypeAny>(schema: S, value: unknown): z.infer<S> {
  return schema.parse(value);
}

export function errorHandler(err: Error & { statusCode?: number; code?: string }, req: FastifyRequest, reply: FastifyReply) {
  if (err instanceof ZodError) {
    return reply.code(400).send({ error: 'validation', message: 'Dados inválidos.', issues: err.issues.map((i) => ({ path: i.path.join('.'), message: i.message })) });
  }
  if (err instanceof HttpError) return reply.code(err.status).send({ error: err.code, message: err.message });
  const pgCode = (err as { code?: string }).code ?? (err.cause as { code?: string } | undefined)?.code;
  if (pgCode === '23505') return reply.code(409).send({ error: 'conflict', message: 'Já existe um registro com estes dados.' });
  if (pgCode === '23503') return reply.code(400).send({ error: 'reference', message: 'Registro relacionado não existe.' });
  if (err.statusCode && err.statusCode < 500) return reply.code(err.statusCode).send({ error: err.code ?? 'bad_request', message: err.message });
  req.log.error(err);
  return reply.code(500).send({ error: 'internal', message: 'Erro interno. Tente novamente.' });
}

/* Validadores comuns */
export const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use AAAA-MM-DD');
export const uuid = z.string().uuid();
export const periodQuery = z.object({ from: isoDate.optional(), to: isoDate.optional() });
