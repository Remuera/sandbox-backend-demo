import { describe, expect, test } from "bun:test";
import {
  NTP_EPOCH_OFFSET_SECONDS,
  buildRequestPacket,
  computeOffset,
  parseResponsePacket,
  toUnixMs,
} from "./ntp.js";

const UNIX_SECONDS = Date.UTC(2026, 10, 4, 12, 0, 0) / 1000;
const NTP_SECONDS = UNIX_SECONDS + NTP_EPOCH_OFFSET_SECONDS;
const HALF_SECOND = 2 ** 31;

function buildResponse({
  leapIndicator = 0,
  mode = 4,
  stratum = 2,
  referenceId = "",
  receiveSeconds = NTP_SECONDS,
  receiveFraction = 0,
  transmitSeconds = NTP_SECONDS,
  transmitFraction = HALF_SECOND,
} = {}) {
  const bytes = new Uint8Array(48);
  const view = new DataView(bytes.buffer);
  view.setUint8(0, (leapIndicator << 6) | (4 << 3) | mode);
  view.setUint8(1, stratum);
  bytes.set(new TextEncoder().encode(referenceId), 12);
  view.setUint32(32, receiveSeconds);
  view.setUint32(36, receiveFraction);
  view.setUint32(40, transmitSeconds);
  view.setUint32(44, transmitFraction);
  return bytes;
}

describe("buildRequestPacket", () => {
  test("ist 48 Byte lang, Byte 0 ist 0x23, der Rest ist 0", () => {
    const packet = buildRequestPacket();
    expect(packet.length).toBe(48);
    expect(packet[0]).toBe(0x23);
    expect(packet.subarray(1).every((byte) => byte === 0)).toBe(true);
  });
});

describe("toUnixMs", () => {
  test("rechnet Sekunden und Fraktion in Unix-Millisekunden um", () => {
    expect(toUnixMs(NTP_SECONDS, HALF_SECOND)).toBe(UNIX_SECONDS * 1000 + 500);
  });
});

describe("parseResponsePacket", () => {
  test("liest Mode, Stratum und beide Timestamps", () => {
    const packet = parseResponsePacket(buildResponse());
    expect(packet.leapIndicator).toBe(0);
    expect(packet.versionNumber).toBe(4);
    expect(packet.mode).toBe(4);
    expect(packet.stratum).toBe(2);
    expect(packet.receiveTimestamp).toBe(UNIX_SECONDS * 1000);
    expect(new Date(packet.transmitTimestamp).toISOString()).toBe("2026-11-04T12:00:00.500Z");
  });

  test("funktioniert mit einem Buffer auf einem Ausschnitt eines größeren ArrayBuffers", () => {
    const backing = new Uint8Array(64);
    backing.set(buildResponse(), 8);
    const buffer = Buffer.from(backing.buffer, 8, 48);

    expect(buffer.byteOffset).toBe(8);
    expect(parseResponsePacket(buffer).receiveTimestamp).toBe(UNIX_SECONDS * 1000);
  });

  test.each([
    ["zu kurzem Paket", new Uint8Array(47), "47"],
    ["zu langem Paket", new Uint8Array(49), "49"],
    ["falschem Mode", buildResponse({ mode: 3 }), "Mode 3"],
    ["unsynchronisiertem Server", buildResponse({ leapIndicator: 3 }), "nicht synchronisiert"],
    ["Stratum 0", buildResponse({ stratum: 0, referenceId: "RATE" }), "RATE"],
    ["Stratum über 15", buildResponse({ stratum: 16 }), "Stratum 16"],
    [
      "fehlendem Transmit-Timestamp",
      buildResponse({ transmitSeconds: 0, transmitFraction: 0 }),
      "Transmit-Timestamp",
    ],
  ])("wirft bei %s", (_name, bytes, message) => {
    expect(() => parseResponsePacket(bytes)).toThrow(message);
  });
});

describe("computeOffset", () => {
  test("berechnet Offset und Roundtrip", () => {
    expect(computeOffset({ t1: 0, t2: 100, t3: 100, t4: 20 })).toEqual({
      offsetMs: 90,
      roundtripMs: 20,
    });
  });
});
