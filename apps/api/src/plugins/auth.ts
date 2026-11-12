import fp from 'fastify-plugin';
import jwt from '@fastify/jwt';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { Env } from '../env.js';

export type Role = 'ADMIN' | 'GESTOR' | 'MOTORISTA' | 'LEITOR';
export interface TokenUser { sub: string; org: string; role: Role; name: string; driverId: string | null }

declare module '@fastify/jwt' {
  interface FastifyJWT { payload: TokenUser; user: TokenUser }
}
declare module 'fastify' {
  interface FastifyInstance {
    authenticate: (req: FastifyRequest, reply: FastifyReply) => Promise<void>;
    requireRole: (...roles: Role[]) => (req: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }
}

/**
 * Perfis:
 * - ADMIN: tudo, inclusive usuários e parâmetros.
 * - GESTOR: cadastros, manutenção, documentos, custos, importações, correções de registros.
 * - MOTORISTA: lê o painel e registra as próprias viagens e abastecimentos.
 * - LEITOR: somente leitura.
 */
export const WRITE_ROLES: Role[] = ['ADMIN', 'GESTOR'];

export default fp<{ env: Env }>(async (app, { env }) => {
  await app.register(jwt, { secret: env.JWT_SECRET, sign: { expiresIn: env.JWT_EXPIRES_IN } });
  app.decorate('authenticate', async (req: FastifyRequest, reply: FastifyReply) => {
    try { await req.jwtVerify(); } catch { return reply.code(401).send({ error: 'unauthorized', message: 'Sessão inválida ou expirada.' }); }
  });
  app.decorate('requireRole', (...roles: Role[]) => async (req: FastifyRequest, reply: FastifyReply) => {
    if (!roles.includes(req.user.role)) return reply.code(403).send({ error: 'forbidden', message: 'Seu perfil não permite esta ação.' });
  });
});
