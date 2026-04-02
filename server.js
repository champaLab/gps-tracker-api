const net = require('net');
const { parseST901Data, isSt901GpsReport } = require('./lib/parser.js');

const HOST = process.env.HOST ?? '0.0.0.0';
const PORT = Number(process.env.PORT ?? 31111);
const LOG_NON_GPS = process.env.LOG_NON_GPS === '1';
const LOG_RAW = process.env.LOG_RAW === '1';

function logJson(obj) {
  console.log(JSON.stringify(obj));
}

function gpsLogRecord(remote, parsed) {
  const row = {
    type: 'st901_gps',
    receivedAt: new Date().toISOString(),
    remote,
    deviceId: parsed.ID != null ? String(parsed.ID) : null,
    latitude: parsed.latitude,
    longitude: parsed.longitude,
    date: parsed.Date,
    time: parsed.Time,
    fix: parsed.FIX,
    speed: parsed.Speed,
    battery: parsed.BAT,
    url: parsed.url,
  };
  if (LOG_RAW) row.raw = parsed.raw;
  return row;
}

const server = net.createServer((socket) => {
  const remote = `${socket.remoteAddress}:${socket.remotePort}`;
  console.log(`Device connected: ${remote}`);

  let buffer = '';

  socket.on('data', (chunk) => {
    buffer += chunk.toString('utf8');
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() ?? '';

    for (const line of lines) {
      const rawData = line.trim();
      if (!rawData) continue;

      const parsed = parseST901Data(rawData);
      if (isSt901GpsReport(parsed)) {
        logJson(gpsLogRecord(remote, parsed));
      } else if (LOG_NON_GPS) {
        logJson({
          type: 'ignored',
          receivedAt: new Date().toISOString(),
          remote,
          reason: parsed.parseError ?? 'not_a_gps_report',
          preview:
            rawData.length > 240 ? `${rawData.slice(0, 240)}…` : rawData,
        });
      }
    }
  });

  socket.on('close', () => {
    console.log(`Device disconnected: ${remote}`);
  });

  socket.on('error', (err) => {
    console.error('Socket error:', err);
  });
});

server.listen(PORT, HOST, () => {
  console.log(`Server listening on ${HOST}:${PORT}`);
});
