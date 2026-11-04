# backend

JavaScript-Backend auf Basis von [Bun](https://bun.com).

## Voraussetzungen

Bun installieren (falls noch nicht vorhanden):

```bash
curl -fsSL https://bun.sh/install | bash
```

## Einrichtung

```bash
bun install
cp .env.example .env
```

## Scripts

| Befehl         | Beschreibung                                    |
| -------------- | ----------------------------------------------- |
| `bun run dev`  | Server mit Hot-Reload starten (`--hot`)         |
| `bun run start`| Server ohne Hot-Reload starten                  |
| `bun test`     | Tests ausführen (`*.test.js`)                   |

Der Server läuft standardmäßig auf http://localhost:3000 (`PORT` in `.env` anpassbar).

## Endpunkte

| Methode | Pfad      | Beschreibung                         |
| ------- | --------- | ------------------------------------ |
| `GET`   | `/`       | Begrüßung                            |
| `GET`   | `/health` | Statusprüfung                        |
| `GET`   | `/time`   | Aktuelle UTC-Zeit, per NTP ermittelt |

### `GET /time`

```json
{
  "iso": "2026-11-04T12:00:00.250Z",
  "unixMs": 1793793600250,
  "source": "ntp",
  "server": "pool.ntp.org",
  "stratum": 2,
  "offsetMs": 12.5,
  "roundtripMs": 20,
  "syncedAt": "2026-11-04T11:59:40.100Z"
}
```

Ein Sync gilt für `NTP_CACHE_MS`, dazwischen wird die Zeit aus lokaler Uhr und
Offset abgeleitet. Ist kein Zeitserver erreichbar, kommt ebenfalls `200`, aber mit
der Systemuhr: `source` ist dann `"system"`, `warning` ist `"ntp_unavailable"` und
`server`, `stratum`, `offsetMs`, `roundtripMs` und `syncedAt` sind `null`. Wer
zwingend NTP-Zeit braucht, muss `source` prüfen. Neue Versuche pausieren nach einem
Fehlschlag für `NTP_CACHE_MS`.

## Umgebungsvariablen

| Variable         | Standard       | Beschreibung                                                               |
| ---------------- | -------------- | -------------------------------------------------------------------------- |
| `PORT`           | `3000`         | Port des HTTP-Servers                                                      |
| `NTP_SERVER`     | `pool.ntp.org` | Zeitserver für `/time`                                                     |
| `NTP_TIMEOUT_MS` | `3000`         | Maximale Dauer einer NTP-Abfrage                                           |
| `NTP_CACHE_MS`   | `60000`        | Gültigkeit eines Syncs und Pause nach Fehlschlag; `0` schaltet beides ab     |

## Struktur

```
src/
  index.js       Einstiegspunkt (Bun.serve)
  index.test.js  Beispieltest (bun:test)
  ntp.js         SNTP-Protokoll und UDP-Abfrage
  ntp.test.js    Tests für das Protokoll
  time.js        Handler für GET /time mit Offset-Cache
  time.test.js   Tests für Handler, Cache und Fallback
jsconfig.json    Editor-Autovervollständigung für Bun-APIs
.env.example     Vorlage für Umgebungsvariablen
```
