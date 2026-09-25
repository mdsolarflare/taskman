/**
 * Minimal CDP client.
 *
 * Uses the raw WebSocket API — no helper libraries. Handles:
 * - Connection lifecycle (open/close)
 * - Session-scoped messaging (Target.attachToTarget → sessionId → Runtime.evaluate)
 * - Preserving ordering by message id
 *   (Promise resolution with per-message-id queues via `pending`)
 */

interface CdpMessage {
  id?: number;
  method?: string;
  sessionId?: string;
  params?: Record<string, unknown>;
  result?: unknown;
  error?: { code: number; message: string };
}

// ---------------------------------------------------------------------------
// Public surface
// ---------------------------------------------------------------------------

/** When called from tests, evaluate a sync/async body on the page. */
export function evaluateWith<T = unknown>(
  conn: CdpSession,
  fn: (() => T | Promise<T>) | string,
): Promise<T> {
  const expr = typeof fn === "string" ? fn : `(${fn.toString()})()`;
  return conn.evaluate(expr) as Promise<T>;
}

export class CdpSession {
  private nextId = 1;
  private pending = new Map<number, (msg: CdpMessage) => void>();
  private sock: WebSocket;

  /** Session-scoped id — set externally after Target.attachToTarget. */
  sessionId?: string;

  constructor(sock: WebSocket) {
    this.sock = sock;
    this.wireMessageHandler(sock);
  }

  private wireMessageHandler(sock: WebSocket): void {
    sock.onmessage = (e) => {
      let m: CdpMessage;
      try {
        m = JSON.parse(e.data as string) as CdpMessage;
      } catch {
        return;
      }
      if (m.id !== undefined) {
        const res = this.pending.get(m.id);
        if (res) {
          this.pending.delete(m.id);
          res(m);
        }
      }
      // We drop fire-and-forget notifications (m.id === undefined)
    };
  }

  async evaluate(expression: string): Promise<unknown> {
    const r = await this.send<{
      result: { type: string; value: unknown };
    }>(
      "Runtime.evaluate",
      {
        expression,
        returnByValue: true, // We always want the value back as JSON
        awaitPromise: true,
      },
    );
    return r.result?.value;
  }

  async waitForFunction(
    predicate: string | (() => boolean),
    timeoutMs: number,
  ): Promise<void> {
    // A string predicate is a bare expression ("x > 0"), NOT a function —
    // wrapping it as `(...)()` evaluates e.g. `true()` → TypeError, and the
    // resulting exceptionDetails make every poll return undefined, so the
    // wait times out. Only function predicates get the call wrapper.
    const expr = typeof predicate === "string"
      ? predicate
      : `(${predicate.toString()})()`;
    const start = Date.now();
    while (true) {
      const done = await this.evaluate(expr);
      if (done) return;
      if (Date.now() - start > timeoutMs) {
        throw new Error(
          `waitForFunction timed out (${timeoutMs}ms): ${expr}`,
        );
      }
      await new Promise((r) => setTimeout(r, 100));
    }
  }

  async send<T>(method: string, params?: Record<string, unknown>): Promise<T> {
    const id = this.nextId++;
    const msg: CdpMessage = { id, method };
    if (params) msg.params = params;
    if (this.sessionId !== undefined) msg.sessionId = this.sessionId;
    return new Promise<T>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`CDP call ${method} timed out`));
      }, 10000);
      this.pending.set(id, (m) => {
        clearTimeout(timeout);
        if (m.error) {
          reject(new Error(`CDP error in ${method}: ${m.error.message}`));
        } else {
          resolve(m.result as T);
        }
      });
      try {
        this.sock.send(JSON.stringify(msg));
      } catch (err) {
        clearTimeout(timeout);
        this.pending.delete(id);
        reject(err instanceof Error ? err : new Error(String(err)));
      }
    });
  }

  async close(): Promise<void> {
    try {
      this.sock.close();
    } catch {
      /* already closed */
    }
  }
}

async function openWebSocket(ws: string): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const sock = new WebSocket(ws);
    sock.onopen = () => resolve(sock);
    sock.onerror = (e) =>
      reject(new Error(`WebSocket open failed: ${String(e)}`));
  });
}

// ---------------------------------------------------------------------------
// Browser management (open page, PID discovery)
// ---------------------------------------------------------------------------

export async function openBrowserPage(
  browserWs: string,
  url: string,
): Promise<{ conn: CdpSession; pid: number; close: () => Promise<void> }> {
  // Attach at browser level via /json/version's ws URL, then delegate to a
  // session.
  const conn = new CdpSession(await openWebSocket(browserWs));

  const { targetId } = await conn.send<{ targetId: string }>(
    "Target.createTarget",
    { url: "about:blank" },
  );

  const { sessionId } = await conn.send<{ sessionId: string }>(
    "Target.attachToTarget",
    { targetId, flatten: true },
  );
  conn.sessionId = sessionId;

  // Enable the runtime, and page lifecycle, so we can evaluate JS.
  await conn.send("Runtime.enable");
  await conn.send("Page.enable");

  // Navigate to the target URL
  await conn.send("Page.navigate", { url });

  return {
    conn,
    pid: 0, // populated separately below (browser via endpoint)
    close: async () => {
      try {
        await conn.send("Target.closeTarget", { targetId });
      } catch {
        /* already closed */
      }
      await conn.close();
    },
  };
}
