import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { createTimeHandler } from "./time.js";

const START = Date.UTC(2026, 10, 4, 12, 0, 0);
const NTP_RESULT = {
  offsetMs: 250,
  roundtripMs: 20,
  stratum: 2,
  server: "ntp.test",
  address: "192.0.2.10",
};

function setup({ query = async () => NTP_RESULT, ...options } = {}) {
  const clock = { time: START };
  const calls = [];
  const handler = createTimeHandler({
    query: (args) => {
      calls.push(args);
      return query(args);
    },
    env: {},
    server: "ntp.test",
    cacheMs: 1000,
    now: () => clock.time,
    ...options,
  });
  return { calls, clock, handler };
}

async function read(handler) {
  const response = await handler();
  return { response, body: await response.json() };
}

const failingQuery = async () => {
  throw new Error("kein Netz");
};

let warn;

beforeEach(() => {
  warn = spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  warn.mockRestore();
});

describe("Erfolg", () => {
  test("liefert NTP-Zeit mit allen Feldern", async () => {
    const { handler } = setup();
    const { response, body } = await read(handler);

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toContain("application/json");
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(body).toEqual({
      iso: "2026-11-04T12:00:00.250Z",
      unixMs: START + 250,
      source: "ntp",
      server: "ntp.test",
      stratum: 2,
      offsetMs: 250,
      roundtripMs: 20,
      syncedAt: "2026-11-04T12:00:00.250Z",
    });
  });

  test("gibt Server und Timeout an die Abfrage weiter", async () => {
    const { calls, handler } = setup({ timeoutMs: 500 });
    await handler();
    expect(calls).toEqual([{ host: "ntp.test", timeoutMs: 500 }]);
  });
});

describe("Cache", () => {
  test("nutzt den Offset innerhalb von cacheMs weiter", async () => {
    const { calls, clock, handler } = setup();
    const first = await read(handler);
    clock.time += 999;
    const second = await read(handler);

    expect(calls.length).toBe(1);
    expect(second.body.unixMs).toBe(START + 999 + 250);
    expect(second.body.syncedAt).toBe(first.body.syncedAt);
  });

  test("synchronisiert nach Ablauf von cacheMs neu", async () => {
    const { calls, clock, handler } = setup();
    await handler();
    clock.time += 1000;
    await handler();
    expect(calls.length).toBe(2);
  });

  test("cacheMs 0 synchronisiert bei jedem Aufruf", async () => {
    const { calls, handler } = setup({ cacheMs: 0 });
    await handler();
    await handler();
    expect(calls.length).toBe(2);
  });

  test("parallele Aufrufe teilen sich eine Abfrage", async () => {
    const { promise, resolve } = Promise.withResolvers();
    const { calls, handler } = setup({ query: () => promise });
    const pending = Promise.all([handler(), handler()]);
    await Bun.sleep(0);
    resolve(NTP_RESULT);
    const responses = await pending;

    expect(calls.length).toBe(1);
    expect(responses.map((response) => response.status)).toEqual([200, 200]);
  });
});

describe("Fallback auf die Systemuhr", () => {
  test("liefert die Systemzeit, wenn die Abfrage fehlschlägt", async () => {
    const { handler } = setup({ query: failingQuery });
    const { response, body } = await read(handler);

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(body).toEqual({
      iso: "2026-11-04T12:00:00.000Z",
      unixMs: START,
      source: "system",
      server: null,
      stratum: null,
      offsetMs: null,
      roundtripMs: null,
      syncedAt: null,
      warning: "ntp_unavailable",
    });
  });

  test("loggt den Fehler, gibt ihn aber nicht an Nutzer weiter", async () => {
    const { handler } = setup({ query: failingQuery });
    const { body } = await read(handler);

    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toContain("kein Netz");
    expect(JSON.stringify(body)).not.toContain("kein Netz");
  });

  test("fängt auch synchron geworfene Fehler ab und versucht es später erneut", async () => {
    const query = () => {
      throw new Error("synchron");
    };
    const { calls, clock, handler } = setup({ query });
    expect((await read(handler)).body.source).toBe("system");
    clock.time += 1000;
    expect((await read(handler)).body.source).toBe("system");
    expect(calls.length).toBe(2);
  });

  test("versucht es innerhalb von cacheMs nicht erneut, danach wieder", async () => {
    let online = false;
    const query = async () => {
      if (!online) throw new Error("kein Netz");
      return NTP_RESULT;
    };
    const { calls, clock, handler } = setup({ query });

    await handler();
    clock.time += 999;
    expect((await read(handler)).body.source).toBe("system");
    expect(calls.length).toBe(1);

    online = true;
    clock.time += 1;
    expect((await read(handler)).body.source).toBe("ntp");
    expect(calls.length).toBe(2);
  });

  test("verwendet einen abgelaufenen Offset nicht weiter", async () => {
    let online = true;
    const query = async () => {
      if (!online) throw new Error("kein Netz");
      return NTP_RESULT;
    };
    const { clock, handler } = setup({ query });

    await handler();
    online = false;
    clock.time += 1000;
    const { body } = await read(handler);

    expect(body.source).toBe("system");
    expect(body.unixMs).toBe(clock.time);
  });
});

describe("Konfiguration", () => {
  function fromEnv(env) {
    const calls = [];
    const handler = createTimeHandler({
      env,
      now: () => START,
      query: async (args) => {
        calls.push(args);
        return NTP_RESULT;
      },
    });
    return { calls, handler };
  }

  test("liest Server, Timeout und Cache aus der Umgebung", async () => {
    const { calls, handler } = fromEnv({
      NTP_SERVER: "zeit.test",
      NTP_TIMEOUT_MS: "750",
      NTP_CACHE_MS: "0",
    });
    await handler();
    await handler();
    expect(calls).toEqual([
      { host: "zeit.test", timeoutMs: 750 },
      { host: "zeit.test", timeoutMs: 750 },
    ]);
  });

  test.each(["abc", "-1", "", "Infinity"])("nutzt die Defaults bei %p", async (value) => {
    const { calls, handler } = fromEnv({ NTP_TIMEOUT_MS: value, NTP_CACHE_MS: value });
    await handler();
    await handler();
    expect(calls).toEqual([{ host: "pool.ntp.org", timeoutMs: 3000 }]);
  });
});
