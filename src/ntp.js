/** Sekunden zwischen der NTP-Epoche (1900-01-01) und der Unix-Epoche (1970-01-01). */
export const NTP_EPOCH_OFFSET_SECONDS = 2_208_988_800;

const PACKET_LENGTH = 48;
const MODE_SERVER = 4;
const LEAP_UNSYNCHRONIZED = 3;
const MAX_STRATUM = 15;

/** Client-Anfrage: LI 0, Version 4, Mode 3. */
export function buildRequestPacket() {
  const packet = new Uint8Array(PACKET_LENGTH);
  packet[0] = 0x23;
  return packet;
}

export function toUnixMs(seconds, fraction) {
  return (seconds - NTP_EPOCH_OFFSET_SECONDS) * 1000 + (fraction / 2 ** 32) * 1000;
}

export function parseResponsePacket(bytes) {
  if (bytes.byteLength !== PACKET_LENGTH) {
    throw new Error(`NTP-Antwort hat ${bytes.byteLength} statt ${PACKET_LENGTH} Byte`);
  }

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const flags = view.getUint8(0);
  const leapIndicator = flags >> 6;
  const versionNumber = (flags >> 3) & 0b111;
  const mode = flags & 0b111;
  const stratum = view.getUint8(1);

  if (mode !== MODE_SERVER) {
    throw new Error(`NTP-Antwort hat Mode ${mode} statt ${MODE_SERVER}`);
  }
  if (leapIndicator === LEAP_UNSYNCHRONIZED) {
    throw new Error("NTP-Server ist nicht synchronisiert");
  }
  if (stratum === 0) {
    const kissCode = String.fromCharCode(...bytes.subarray(12, 16));
    throw new Error(`NTP-Server meldet Kiss-of-Death: ${kissCode}`);
  }
  if (stratum > MAX_STRATUM) {
    throw new Error(`NTP-Antwort hat ungültiges Stratum ${stratum}`);
  }

  const transmitSeconds = view.getUint32(40);
  const transmitFraction = view.getUint32(44);
  if (transmitSeconds === 0 && transmitFraction === 0) {
    throw new Error("NTP-Antwort hat keinen Transmit-Timestamp");
  }

  return {
    leapIndicator,
    versionNumber,
    mode,
    stratum,
    receiveTimestamp: toUnixMs(view.getUint32(32), view.getUint32(36)),
    transmitTimestamp: toUnixMs(transmitSeconds, transmitFraction),
  };
}

export function computeOffset({ t1, t2, t3, t4 }) {
  return {
    offsetMs: (t2 - t1 + (t3 - t4)) / 2,
    roundtripMs: t4 - t1 - (t3 - t2),
  };
}

/** Fragt einen Zeitserver per SNTP ab. `timeoutMs` gilt für DNS und UDP zusammen. */
export async function queryNtp({ host, port = 123, timeoutMs = 3000 }) {
  const { promise: response, resolve, reject } = Promise.withResolvers();
  const timer = setTimeout(
    () => reject(new Error(`NTP-Abfrage an ${host} nach ${timeoutMs} ms abgebrochen`)),
    timeoutMs,
  );
  let socket;

  try {
    const [{ address }] = await Promise.race([
      Bun.dns.lookup(host, { family: 4 }),
      response,
    ]);
    let t1;

    socket = await Bun.udpSocket({
      socket: {
        data(_socket, buffer, fromPort, fromAddress) {
          if (fromPort !== port || fromAddress !== address) return;

          const t4 = Date.now();
          try {
            const packet = parseResponsePacket(buffer);
            const { offsetMs, roundtripMs } = computeOffset({
              t1,
              t2: packet.receiveTimestamp,
              t3: packet.transmitTimestamp,
              t4,
            });
            resolve({ offsetMs, roundtripMs, stratum: packet.stratum, server: host, address });
          } catch (error) {
            reject(error);
          }
        },
      },
    });

    t1 = Date.now();
    if (!socket.send(buildRequestPacket(), port, address)) {
      throw new Error(`NTP-Anfrage an ${host} konnte nicht gesendet werden`);
    }

    return await response;
  } finally {
    clearTimeout(timer);
    socket?.close();
  }
}
