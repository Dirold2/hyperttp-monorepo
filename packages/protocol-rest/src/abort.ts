/**
 * @ru Создаёт AbortSignal с тайм-аутом и привязкой к пользовательскому сигналу отмены.
 * @en Creates an AbortSignal with timeout and user abort signal binding.
 * @param userSignal - Optional external abort signal.
 * @param timeoutMs - Timeout in milliseconds.
 * @param meta - Metadata object receiving the cleanup function.
 * @returns AbortSignal bound to the timeout and user signal.
 */
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

/**
 * @ru Применяет тайм-аут к сигналу отмены.
 * @en Applies a timeout to the abort signal.
 * @param signal - Optional external abort signal.
 * @param timeout - Timeout in milliseconds (skip if null/<=0).
 * @param meta - Metadata object receiving the cleanup function.
 * @returns New abort signal with timeout, or the original signal.
 */
export function applyTimeout(
  signal: AbortSignal | undefined,
  timeout: number | undefined,
  meta: { cleanupSignal?: () => void },
  timeoutReason?: unknown | (() => unknown),
): AbortSignal | undefined {
  if (timeout == null || timeout <= 0) return signal;
  return createTimeoutSignal(signal, timeout, meta, timeoutReason);
}
