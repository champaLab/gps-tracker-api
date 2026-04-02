const net = require('net');
const { parseST901Data, parseHqData, isSt901GpsReport } = require('./lib/parser.js');

const HOST = process.env.HOST ?? '0.0.0.0';
const PORT = Number(process.env.PORT ?? 31111);
const LOG_NON_GPS = process.env.LOG_NON_GPS === '1';
const LOG_RAW = process.env.LOG_RAW === '1';
const LOG_TCP_DEBUG = process.env.LOG_TCP_DEBUG === '1';
/** Log each TCP chunk before line splitting / parse (`LOG_DATA_BEFORE_CONSUME=0` to disable). */
const LOG_DATA_BEFORE_CONSUME = process.env.LOG_DATA_BEFORE_CONSUME !== '0';

/** Line breaks: LF, CRLF, or old Mac CR (some trackers use CR only). */
const LINE_SPLIT = /\r\n|\n|\r/g;
const STAR = 0x2a; // '*'
const HASH = 0x23; // '#'

function logJson(obj) {
  console.log(JSON.stringify(obj));
}

function gpsLogRecord(remote, parsed) {
  const row = {
    type: parsed.proto === 'HQ' ? 'hq_gps' : 'st901_gps',
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
  if (parsed.proto === 'HQ') {
    row.ver = parsed.VER;
    row.status = parsed.STATUS;
    row.course = parsed.Course;
  }
  if (LOG_RAW) row.raw = parsed.raw;
  return row;
}

function processOneLine(remote, rawData) {
  const parsed = rawData.startsWith('*HQ') ? parseHqData(rawData) : parseST901Data(rawData);
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

function safeTextPreview(buf, limit) {
  const s = buf.toString('utf8');
  return s.length > limit ? `${s.slice(0, limit)}…` : s;
}

function hexPreview(buf, bytes = 80) {
  return buf.subarray(0, Math.min(buf.length, bytes)).toString('hex');
}

function logDataBeforeConsume(remote, buffer, chunk) {
  if (!LOG_DATA_BEFORE_CONSUME || !chunk?.length) return;
  const preview = safeTextPreview(chunk, 200);
  const row = {
    type: 'data_before_consume',
    receivedAt: new Date().toISOString(),
    remote,
    bufferLen: buffer.length,
    chunkBytes: chunk.length,
    preview,
  };
  if (LOG_TCP_DEBUG) {
    row.chunkHex = hexPreview(chunk, 80);
    row.bufferHex = hexPreview(buffer, 80);
    // show readable tail of buffer (often contains *HQ)
    const tail = buffer.subarray(Math.max(0, buffer.length - 240));
    row.bufferTailText = safeTextPreview(tail, 240);
  }
  logJson(row);
}

function consumeFramesAndLines(remote, buffer, chunk) {
  // binary-safe: keep buffer as Buffer, extract ASCII frames only when complete
  let buf = Buffer.concat([buffer, chunk]);

  // Extract *...# frames (HQ uses this)
  while (true) {
    const start = buf.indexOf(STAR);
    if (start === -1) {
      // no frame start, keep last small tail only
      return buf.length > 1024 ? buf.subarray(buf.length - 256) : buf;
    }
    if (start > 0) buf = buf.subarray(start);
    const end = buf.indexOf(HASH, 1);
    if (end === -1) {
      // incomplete frame, keep it (cap size)
      return buf.length > 64 * 1024 ? buf.subarray(0, 64 * 1024) : buf;
    }

    const frameBuf = buf.subarray(0, end + 1);
    buf = buf.subarray(end + 1);
    const frameText = frameBuf.toString('utf8').trim();
    if (frameText) processOneLine(remote, frameText);
  }
}

const server = net.createServer((socket) => {
  const remote = `${socket.remoteAddress}:${socket.remotePort}`;
  console.log(`Device connected: ${remote}`);

  let buffer = Buffer.alloc(0);

  socket.on('data', (chunk) => {
    logDataBeforeConsume(remote, buffer, chunk);
    buffer = consumeFramesAndLines(remote, buffer, chunk);
  });

  socket.on('close', () => {
    // Only flush tail if it looks like a text packet (avoid logging binary junk)
    const tailText = buffer.toString('utf8').trim();
    if (tailText.startsWith('*') || tailText.includes(' Date:') || tailText.startsWith('http')) {
      processOneLine(remote, tailText);
    }
    buffer = Buffer.alloc(0);
    console.log(`Device disconnected: ${remote}`);
  });

  socket.on('error', (err) => {
    console.error('Socket error:', err);
  });
});

server.listen(PORT, HOST, () => {
  console.log(`Server listening on ${HOST}:${PORT}`);
});
