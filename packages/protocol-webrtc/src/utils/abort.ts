export function createTimeoutSignal(
  userSignal: AbortSignal | undefined,
  timeoutMs: number,
  meta: { cleanupSignal?: () => void },
  timeoutReason?: unknown | (() => unknown),
): AbortSignal {
  const controller = new AbortController();

  let cleaned = false;
  const cleanup = () => {
    if (cleaned) return;
    cleaned = true;

    if (userSignal) {
      userSignal.removeEventListener("abort", onUserAbort);
    }
    clearTimeout(timeoutId);
  };

  const timeoutId = setTimeout(() => {
    (controller.signal as { isTimeout?: boolean }).isTimeout = true;
    const reason =
      typeof timeoutReason === "function" ? (timeoutReason as () => unknown)() : timeoutReason;
    controller.abort(reason ?? new DOMException("Timeout", "TimeoutError"));
    cleanup();
  }, timeoutMs);

  const onUserAbort = () => {
    controller.abort(userSignal?.reason);
    cleanup();
  };

  if (userSignal) {
    if (userSignal.aborted) {
      onUserAbort();
    } else {
      userSignal.addEventListener("abort", onUserAbort);
    }
  }

  meta.cleanupSignal = cleanup;

  return controller.signal;
}

export function applyTimeout(
  signal: AbortSignal | undefined,
  timeout: number | undefined,
  meta: { cleanupSignal?: () => void },
  timeoutReason?: unknown | (() => unknown),
): AbortSignal | undefined {
  if (timeout == null || timeout <= 0) return signal;
  return createTimeoutSignal(signal, timeout, meta, timeoutReason);
}
