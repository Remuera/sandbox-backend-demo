import { queryNtp } from "./ntp.js";

const DEFAULT_SERVER = "pool.ntp.org";
const DEFAULT_TIMEOUT_MS = 3000;
const DEFAULT_CACHE_MS = 60_000;

function nonNegativeNumber(value, fallback) {
  if (value === undefined || value.trim() === "") return fallback;
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : fallback;
}

function timeResponse(body) {
  return Response.json(body, { headers: { "Cache-Control": "no-store" } });
}

/**
 * Erzeugt den Handler für `GET /time`. Ein Sync gilt `cacheMs` lang, dazwischen
 * wird die Zeit aus lokaler Uhr plus Offset abgeleitet. Schlägt ein Sync fehl,
 * liefert der Handler `cacheMs` lang ohne neuen Versuch die Systemuhr.
 */
export function createTimeHandler({
  query = queryNtp,
  env = Bun.env,
  server = env.NTP_SERVER || DEFAULT_SERVER,
  timeoutMs = nonNegativeNumber(env.NTP_TIMEOUT_MS, DEFAULT_TIMEOUT_MS),
  cacheMs = nonNegativeNumber(env.NTP_CACHE_MS, DEFAULT_CACHE_MS),
  now = () => Date.now(),
} = {}) {
  let sync = null;
  let lastFailureAt = null;
  let inFlight = null;

  const isWithinCache = (timestamp) => timestamp !== null && now() - timestamp < cacheMs;

  function refresh() {
    inFlight ??= Promise.resolve()
      .then(() => query({ host: server, timeoutMs }))
      .then(
        (result) => {
          sync = { ...result, syncedAt: now() };
          lastFailureAt = null;
        },
        (error) => {
          sync = null;
          lastFailureAt = now();
          console.warn(`NTP-Sync fehlgeschlagen, nutze Systemuhr: ${error.message}`);
        },
      )
      .finally(() => {
        inFlight = null;
      });
    return inFlight;
  }

  return async () => {
    if (!isWithinCache(sync?.syncedAt ?? null) && !isWithinCache(lastFailureAt)) {
      await refresh();
    }

    if (sync === null) {
      const unixMs = now();
      return timeResponse({
        iso: new Date(unixMs).toISOString(),
        unixMs,
        source: "system",
        server: null,
        stratum: null,
        offsetMs: null,
        roundtripMs: null,
        syncedAt: null,
        warning: "ntp_unavailable",
      });
    }

    const unixMs = Math.round(now() + sync.offsetMs);
    return timeResponse({
      iso: new Date(unixMs).toISOString(),
      unixMs,
      source: "ntp",
      server: sync.server,
      stratum: sync.stratum,
      offsetMs: sync.offsetMs,
      roundtripMs: sync.roundtripMs,
      syncedAt: new Date(Math.round(sync.syncedAt + sync.offsetMs)).toISOString(),
    });
  };
}
