/** UI deadline includes reconnect/authentication as well as the RPC itself. */
export const TRAINING_REQUEST_TIMEOUT_MS = 15_000;

/** Stop waiting without treating a missing response as authoritative success. */
export function waitForTrainingRequest<T>(
  request: Promise<T>,
  signal: AbortSignal,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const finish = (result: { value: T } | { error: unknown }): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal.removeEventListener('abort', cancel);
      if ('error' in result) reject(result.error);
      else resolve(result.value);
    };
    const cancel = (): void => finish({ error: new Error('training_request_cancelled') });
    const timer = setTimeout(
      () => finish({ error: new Error('training_request_timeout') }),
      TRAINING_REQUEST_TIMEOUT_MS,
    );
    signal.addEventListener('abort', cancel, { once: true });
    // Observe both outcomes even after a timeout/cancellation: a late
    // rejection must never become an unhandled promise rejection.
    request.then(value => finish({ value }), error => finish({ error }));
    if (signal.aborted) cancel();
  });
}
