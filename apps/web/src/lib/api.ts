/** Cliente HTTP da API. O token fica em sessionStorage (some ao fechar o navegador). */
const BASE = (import.meta.env.VITE_API_URL ?? '') + '/api/v1';
/** Endereço completo da API (usado no script de sincronização da planilha). */
export const apiUrl = (path: string) => new URL(BASE + path, window.location.href).toString();
const KEY = 'sgi.token';

export const tokenStore = {
  get: () => { try { return sessionStorage.getItem(KEY); } catch { return null; } },
  set: (t: string | null) => { try { t ? sessionStorage.setItem(KEY, t) : sessionStorage.removeItem(KEY); } catch { /* sem storage */ } },
};

export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string) { super(message); }
}

export async function api<T = unknown>(path: string, init: RequestInit & { json?: unknown } = {}): Promise<T> {
  const headers = new Headers(init.headers);
  const t = tokenStore.get();
  if (t) headers.set('authorization', 'Bearer ' + t);
  let body = init.body;
  if (init.json !== undefined) { headers.set('content-type', 'application/json'); body = JSON.stringify(init.json); }
  const res = await fetch(BASE + path, { ...init, headers, body });
  if (res.status === 401 && !path.startsWith('/auth/login')) { tokenStore.set(null); window.dispatchEvent(new Event('sgi:logout')); }
  if (res.status === 204) return undefined as T;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, data.error ?? 'error', data.message ?? 'Erro ao comunicar com o servidor.');
  return data as T;
}

/** Arquivo protegido pelo login (ex.: foto do checklist), como Blob. */
export async function apiBlob(path: string): Promise<Blob> {
  const t = tokenStore.get();
  const res = await fetch(BASE + path, { headers: t ? { authorization: 'Bearer ' + t } : {} });
  if (!res.ok) throw new ApiError(res.status, 'error', 'Não foi possível abrir o arquivo.');
  return res.blob();
}

/** Envia um arquivo (ou foto já reduzida) no campo "file". */
export const uploadTo = <T = Record<string, unknown>>(path: string, blob: Blob, name: string) => {
  const fd = new FormData(); fd.append('file', blob, name);
  return api<T>(path, { method: 'POST', body: fd });
};

export const upload = (path: string, file: File) => {
  const fd = new FormData(); fd.append('file', file);
  return api<Record<string, unknown>>(path, { method: 'POST', body: fd });
};
