import { trackEvent } from './Analytics.js';

declare const __BUILD_VERSION__: string | undefined;

/** Per-session cap: a render-loop exception must not flood the analytics buffer. */
export const CLIENT_ERROR_MAX_PER_SESSION = 5;
export const CLIENT_ERROR_MESSAGE_MAX_LENGTH = 120;
const SOURCE_MAX_LENGTH = 96;
const NAME_MAX_LENGTH = 40;

export type ClientErrorKind = 'error' | 'rejection';

export interface ClientErrorReport {
  kind: ClientErrorKind;
  /** Error constructor name only, e.g. TypeError. */
  errorName: string;
  /** Scrubbed and truncated; see sanitizeErrorMessage. */
  message: string;
  /** Top frame as `file.js:line:col`, never a full URL or stack. */
  source: string;
  scene: string;
  build: string;
}

/**
 * Error text can echo player data (ids in URLs, tokens, match or room codes,
 * display names inside a failed request). Keep the shape of the problem and
 * drop anything that could identify a player: URLs, emails, digit runs and
 * long identifier-like tokens are masked, then the text is truncated.
 */
export function sanitizeErrorMessage(raw: unknown): string {
  const text = typeof raw === 'string' ? raw : raw instanceof Error ? raw.message : '';
  const cleaned = text
    .replace(/[a-z][a-z0-9+.-]*:\/\/\S+/gi, '<url>')
    .replace(/[^\s@]+@[^\s@]+\.[^\s@]+/g, '<email>')
    .replace(/(?=[A-Za-z_-]*\d)[A-Za-z0-9_-]{16,}/g, '<id>')
    .replace(/\d{3,}/g, '<n>')
    .replace(/\s+/g, ' ')
    .trim();
  return cleaned.slice(0, CLIENT_ERROR_MESSAGE_MAX_LENGTH) || 'unknown';
}

/** `https://host/assets/index-abc.js?token=1` + 12:34 -> `index-abc.js:12:34`. */
export function describeSource(filename: unknown, line: unknown, column: unknown): string {
  if (typeof filename !== 'string' || filename.length === 0) return 'unknown';
  const base = filename.split(/[?#]/)[0].split('/').filter(Boolean).pop() ?? '';
  if (!/^[\w.-]+$/.test(base)) return 'unknown';
  const position = [line, column]
    .filter((value): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0)
    .join(':');
  return `${base}${position ? `:${position}` : ''}`.slice(0, SOURCE_MAX_LENGTH);
}

/** First stack frame of a rejection reason, as `file.js:line:col`. */
function sourceFromStack(stack: unknown): string {
  if (typeof stack !== 'string') return 'unknown';
  const row = stack.split('\n').find((line) => /:\d+:\d+/.test(line)) ?? '';
  const frame = /([^\s()@]+):(\d+):(\d+)\D*$/.exec(row);
  return frame ? describeSource(frame[1], Number(frame[2]), Number(frame[3])) : 'unknown';
}

function errorName(value: unknown): string {
  const name = value instanceof Error ? value.name : '';
  return /^[A-Za-z]{1,40}$/.test(name) ? name.slice(0, NAME_MAX_LENGTH) : 'Error';
}

function buildVersion(): string {
  return typeof __BUILD_VERSION__ !== 'undefined' ? __BUILD_VERSION__ : 'dev';
}

export interface ClientErrorReporterOptions {
  /** Key of the scene on screen, for grouping; unknown when no scene is active. */
  getSceneKey?: () => string;
  report?: (report: ClientErrorReport) => void;
  maxPerSession?: number;
}

/**
 * Installs window-level handlers that report uncaught errors and unhandled
 * promise rejections as `client_error` analytics events. Returns an uninstall
 * function. Reporting never throws and never affects gameplay.
 */
export function installClientErrorReporter(
  target: Pick<Window, 'addEventListener' | 'removeEventListener'>,
  options: ClientErrorReporterOptions = {}
): () => void {
  const report = options.report ?? ((payload) => trackEvent({ name: 'client_error', ...payload }));
  const maxPerSession = options.maxPerSession ?? CLIENT_ERROR_MAX_PER_SESSION;
  const seen = new Set<string>();

  const submit = (kind: ClientErrorKind, name: string, message: string, source: string): void => {
    if (seen.size >= maxPerSession) return;
    const fingerprint = `${kind}|${name}|${source}|${message}`;
    if (seen.has(fingerprint)) return;
    seen.add(fingerprint);
    try {
      report({ kind, errorName: name, message, source, scene: options.getSceneKey?.() || 'unknown', build: buildVersion() });
    } catch {
      // Analytics must never break the app it observes.
    }
  };

  const onError = (event: Event): void => {
    const { message, filename, lineno, colno, error } = event as ErrorEvent;
    // Cross-origin SDK scripts surface as an opaque "Script error." with no
    // location; nothing is actionable there.
    if (!filename && (!message || message === 'Script error.')) return;
    submit('error', errorName(error), sanitizeErrorMessage(error ?? message), describeSource(filename, lineno, colno));
  };

  const onRejection = (event: Event): void => {
    const reason = (event as PromiseRejectionEvent).reason as unknown;
    const stack = reason instanceof Error ? reason.stack : undefined;
    submit('rejection', errorName(reason), sanitizeErrorMessage(reason), sourceFromStack(stack));
  };

  target.addEventListener('error', onError);
  target.addEventListener('unhandledrejection', onRejection);
  return () => {
    target.removeEventListener('error', onError);
    target.removeEventListener('unhandledrejection', onRejection);
  };
}
