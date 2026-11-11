import { useEffect, useState } from 'react';
import type { MatchResponse } from '../../../packages/contracts/src';

export class ApiError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}

export async function api<T>(path: string, options?: RequestInit): Promise<T> {
  const headers = new Headers(options?.headers);
  if (options?.method && options.method !== 'GET') headers.set('X-Toros-Request', '1');
  if (typeof options?.body === 'string') headers.set('Content-Type', 'application/json');
  let response: Response;
  try {
    response = await fetch('/api' + path, { ...options, headers });
  } catch (error) {
    if (options?.signal?.aborted) throw error;
    throw new ApiError('Нет связи с сервером. Проверьте подключение.', 0);
  }
  if (response.status === 204) return undefined as T;
  const data = await response.json().catch(() => null);
  if (!response.ok || !data) throw new ApiError(data?.error ?? 'Сервис временно недоступен.', response.status);
  return data as T;
}

export const request = (method: string, body?: unknown): RequestInit => ({
  method,
  body: body instanceof FormData ? body : body === undefined ? undefined : JSON.stringify(body),
});

export const errorMessage = (error: unknown) => error instanceof Error ? error.message : 'Произошла ошибка. Попробуйте ещё раз.';

export function useMatch(id: number, display = false) {
  const [data, setData] = useState<MatchResponse>();
  const [error, setError] = useState('');
  useEffect(() => {
    const controller = new AbortController();
    let registered = display;
    let timeout: ReturnType<typeof setTimeout>;
    async function update() {
      try {
        const options = { signal: controller.signal };
        if (!registered) {
          await api('/matches/' + id + '/session', { ...options, method: 'POST' });
          registered = true;
        }
        const next = await api<MatchResponse>('/matches/' + id + (display ? '?display=1' : ''), options);
        setData(next);
        setError('');
      } catch (cause) {
        if (controller.signal.aborted) return;
        setError(errorMessage(cause));
        if (cause instanceof ApiError && cause.status === 404) return;
      }
      timeout = setTimeout(update, (document.hidden ? 15000 : 3500) + Math.random() * 500);
    }
    void update();
    return () => { controller.abort(); clearTimeout(timeout); };
  }, [id, display]);
  return { data, error };
}
