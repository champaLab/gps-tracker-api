const net = require('net');
const { parseST901Data, isSt901GpsReport } = require('./lib/parser.js');

const HOST = process.env.HOST ?? '0.0.0.0';
const PORT = Number(process.env.PORT ?? 31111);
const LOG_NON_GPS = process.env.LOG_NON_GPS === '1';
const LOG_RAW = process.env.LOG_RAW === '1';
const LOG_TCP_DEBUG = process.env.LOG_TCP_DEBUG === '1';
/** Log each TCP chunk before line splitting / parse (`LOG_DATA_BEFORE_CONSUME=0` to disable). */
const LOG_DATA_BEFORE_CONSUME = process.env.LOG_DATA_BEFORE_CONSUME !== '0';

/** Line breaks: LF, CRLF, or old Mac CR (some trackers use CR only). */
const LINE_SPLIT = /\r\n|\n|\r/g;

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

function processOneLine(remote, rawData) {
  const parsed = parseST901Data(rawData);
  if (isSt901GpsReport(parsed)) {
    logJson(gpsLogRecord(remote, parsed));
  } else if (LOG_NON_GPS) {
    logJson({
      type: 'ignored',
      receivedAt: new Date().toISOString(),
      remote,
      reason: parsed.parseError ?? 'not_a_gps_report',
      preview: rawData.length > 240 ? `${rawData.slice(0, 240)}…` : rawData,
    });
  }
}

function logDataBeforeConsume(remote, buffer, chunk) {
  if (!LOG_DATA_BEFORE_CONSUME || !chunk?.length) return;
  const text = chunk.toString('utf8');
  const preview = text.length > 200 ? `${text.slice(0, 200)}…` : text;
  const row = {
    type: 'data_before_consume',
    receivedAt: new Date().toISOString(),
    remote,
    bufferLen: buffer.length,
    chunkBytes: chunk.length,
    preview,
  };
  if (LOG_TCP_DEBUG) {
    row.bufferPreview =
      buffer.length > 120 ? `${buffer.slice(0, 120)}…` : buffer;
  }
  logJson(row);
}

function consumeCompleteLines(remote, buffer, chunk) {
  let buf = buffer + chunk.toString('utf8');
  const parts = buf.split(LINE_SPLIT);
  buf = parts.pop() ?? '';

  for (const part of parts) {
    const rawData = part.trim();
    if (rawData) processOneLine(remote, rawData);
  }

  return buf;
}

const server = net.createServer((socket) => {
  const remote = `${socket.remoteAddress}:${socket.remotePort}`;
  console.log(`Device connected: ${remote}`);

  let buffer = '';

  socket.on('data', (chunk) => {
    logDataBeforeConsume(remote, buffer, chunk);
    buffer = consumeCompleteLines(remote, buffer, chunk);
  });

  socket.on('close', () => {
    const tail = buffer.trim();
    if (tail) {
      processOneLine(remote, tail);
    }
    buffer = '';
    console.log(`Device disconnected: ${remote}`);
  });

  socket.on('error', (err) => {
    console.error('Socket error:', err);
  });
});

server.listen(PORT, HOST, () => {
  console.log(`Server listening on ${HOST}:${PORT}`);
});
