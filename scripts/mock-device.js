#!/usr/bin/env node
/**
 * Simulates an ST-901 device: opens a TCP connection and sends mock lines
 * (newline-terminated, same as server expects).
 *
 * Env:
 *   TRACKER_HOST — server host (default 127.0.0.1)
 *   TRACKER_PORT — server port (default 1122, same as server.js)
 *   MOCK_DELAY_MS — pause between lines (default 0)
 *   MOCK_CHUNK — if "1", send each line in small chunks (tests reassembly)
 */
const net = require('net');

const host = process.env.TRACKER_HOST ?? '127.0.0.1';
const port = Number(process.env.TRACKER_PORT ?? 1122);
const delayMs = Number(process.env.MOCK_DELAY_MS ?? 0);
const chunkMode = process.env.MOCK_CHUNK === '1';

const samples = [
  'http://maps.google.com/maps?q=+17.970767,+102.613425 Date:2006-08-17 Time:04:01:07 ID:9170225361 FIX:V Speed:0KM/H BAT:4',
  'http://maps.google.com/maps?q=+13.7563,+100.5018 Date:2026-04-02 Time:12:00:00 ID:TEST001 FIX:A Speed:45KM/H BAT:87',
];

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function sendLine(socket, line) {
  const payload = `${line}\n`;
  if (!chunkMode) {
    socket.write(payload);
    return;
  }
  for (let i = 0; i < payload.length; i += 3) {
    socket.write(payload.slice(i, i + 3));
  }
}

async function main() {
  await new Promise((resolve, reject) => {
    const socket = net.createConnection({ host, port }, async () => {
      console.error(`mock-device: connected to ${host}:${port}`);
      try {
        for (const line of samples) {
          sendLine(socket, line);
          if (delayMs > 0) await sleep(delayMs);
        }
        socket.end();
      } catch (e) {
        reject(e);
      }
    });

    socket.on('error', reject);
    socket.on('close', resolve);
  });
}

main().catch((err) => {
  console.error('mock-device:', err.message);
  process.exit(1);
});
