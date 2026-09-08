import { API_BASE_URL } from '../config/api';

// A one-slot record of the most recent vitals API call, so the home screen can
// show exactly what went to the server and what came back.
//
// Capture is deliberately limited to the vitals endpoints. performRequest also
// carries sign-in and password-reset traffic, and this record is rendered on
// screen - a broader filter would put credentials in front of anyone holding
// the phone. Authorization headers are never recorded at all.

export type ApiExchange = {
  at: number;
  method: string;
  url: string;
  requestBody: unknown;
  status: number | null;
  responseBody: unknown;
  errorMessage: string | null;
  durationMs: number | null;
};

const CAPTURED_PATHS = [/\/api\/v1\/vitals\//i];

/** Whether a request path may be recorded. Credentials must never qualify. */
export function isCapturablePath(path: string): boolean {
  return CAPTURED_PATHS.some(pattern => pattern.test(path));
}

let lastExchange: ApiExchange | null = null;
const listeners = new Set<() => void>();

export function recordApiExchange(exchange: ApiExchange): void {
  if (!isCapturablePath(exchange.url)) return;
  lastExchange = exchange;
  listeners.forEach(listener => {
    try {
      listener();
    } catch {
      // A bad subscriber must not break the request that triggered this.
    }
  });
}

export function getLastApiExchange(): ApiExchange | null {
  return lastExchange;
}

export function subscribeToApiExchange(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function buildRequestUrl(path: string): string {
  return `${API_BASE_URL}${path}`;
}

const MAX_RENDERED_CHARS = 60000;

/** Pretty JSON for display, truncated so a month-long sync cannot lock the UI. */
export function formatExchangeBody(value: unknown): string {
  if (value === undefined) return '(none)';
  if (value === null) return 'null';
  let text: string;
  try {
    text = typeof value === 'string' ? value : JSON.stringify(value, null, 2);
  } catch {
    return '(could not be serialised)';
  }
  if (text == null) return '(none)';
  return text.length > MAX_RENDERED_CHARS
    ? `${text.slice(0, MAX_RENDERED_CHARS)}\n… truncated, ${
        text.length - MAX_RENDERED_CHARS
      } more characters`
    : text;
}
