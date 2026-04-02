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

function bcdBytesToDigits(buf, offset, digitCount) {
  const byteCount = Math.ceil(digitCount / 2);
  if (offset + byteCount > buf.length) return null;
  let out = '';
  for (let i = 0; i < byteCount; i++) {
    const b = buf[offset + i];
    const hi = (b >> 4) & 0x0f;
    const lo = b & 0x0f;
    out += String(hi);
    if (out.length < digitCount) out += String(lo);
  }
  return out.slice(0, digitCount);
}

function ddmmDigitsToDecimal(digits, degDigits) {
  const s = String(digits ?? '');
  if (!/^\d+$/.test(s) || s.length < degDigits + 2) return null;
  const deg = Number(s.slice(0, degDigits));
  const minDigits = s.slice(degDigits); // starts with 2-digit minutes integer
  const minInt = minDigits.slice(0, 2);
  const minFrac = minDigits.slice(2);
  const minutes = Number(minFrac ? `${minInt}.${minFrac}` : minInt);
  if (!Number.isFinite(deg) || !Number.isFinite(minutes)) return null;
  return deg + minutes / 60;
}

function parseBinaryPacket(chunk) {
  // Layout inferred from your sample:
  // 0: '$' (0x24)
  // 1..5: deviceId (10 digits, BCD)
  // 6..8: time hhmmss (BCD)
  // 9..11: date ddmmyy (BCD)
  // 12..15: latitude ddmm.mmmm digits (BCD -> 8 digits)
  // 16: status byte (we treat non-zero as Valid)
  // 17..20: longitude digits (BCD -> 8 digits, interpreted as ddd + mm.mmm)
  // 21..24: unknown (often 0c000000)
  // 25..28: flags (4 bytes)
  if (!chunk?.length || chunk[0] !== 0x24 || chunk.length < 29) return null;

  const deviceId = bcdBytesToDigits(chunk, 1, 10);
  const timeDigits = bcdBytesToDigits(chunk, 6, 6);
  const dateDigits = bcdBytesToDigits(chunk, 9, 6);
  const latDigits = bcdBytesToDigits(chunk, 12, 8);
  const statusByte = chunk[16];
  const lonDigits = bcdBytesToDigits(chunk, 17, 8);
  const flags = chunk.subarray(25, 29).toString('hex').toUpperCase();

  const date = hqDateToYmd(dateDigits);
  const time = hqTimeToHms(timeDigits);
  const timestamp = date && time ? `${date}T${time}` : null;

  const latitude = ddmmDigitsToDecimal(latDigits, 2);
  // lon is 8 digits in this packet: interpret as ddd + mm.mmm (3 decimal places)
  // Example: 10236952 => 102°36.952' => 102.6158667
  const longitude = ddmmDigitsToDecimal(lonDigits, 3);

  if (!deviceId || !date || !time || !Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    return null;
  }

  return {
    protocol: 'binary',
    deviceId,
    date,
    time,
    timestamp,
    latitude,
    longitude,
    speedKmh: 0,
    course: 0,
    gpsStatus: statusByte ? 'Valid' : 'Invalid',
    flags,
    source: 'binary_packet',
  };
}

function parseSpeedToKmh(speed) {
  if (speed == null) return null;
  const s = String(speed).trim();
  // "0KM/H", "45KM/H"
  const kmh = s.match(/^([+-]?\d+(\.\d+)?)\s*KM\/H$/i);
  if (kmh) return Number(kmh[1]);
  // "0.00"
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

function pad2(s) {
  return String(s).padStart(2, '0');
}

function hqTimeToHms(time) {
  const t = String(time ?? '').trim();
  if (!/^\d{6}$/.test(t)) return null;
  return `${t.slice(0, 2)}:${t.slice(2, 4)}:${t.slice(4, 6)}`;
}

function hqDateToYmd(date) {
  const d = String(date ?? '').trim();
  if (!/^\d{6}$/.test(d)) return null; // ddmmyy
  const dd = d.slice(0, 2);
  const mm = d.slice(2, 4);
  const yy = d.slice(4, 6);
  const year = 2000 + Number(yy);
  if (!Number.isFinite(year)) return null;
  return `${year.toString().padStart(4, '0')}-${mm}-${dd}`;
}

function toIsoTimestamp(parsed) {
  // HQ: Date = ddmmyy, Time = hhmmss (UTC unknown; treat as local device time without TZ conversion)
  if (parsed?.proto === 'HQ' && /^\d{6}$/.test(parsed.Date ?? '') && /^\d{6}$/.test(parsed.Time ?? '')) {
    const ymd = hqDateToYmd(parsed.Date);
    const hms = hqTimeToHms(parsed.Time);
    if (ymd && hms) return `${ymd}T${hms}`;
  }

  // ST-901: Date = yyyy-mm-dd, Time = hh:mm:ss
  if (typeof parsed?.Date === 'string' && typeof parsed?.Time === 'string') {
    if (/^\d{4}-\d{2}-\d{2}$/.test(parsed.Date) && /^\d{2}:\d{2}:\d{2}$/.test(parsed.Time)) {
      return `${parsed.Date}T${parsed.Time}`;
    }
  }

  return null;
}

function gpsLogRecord(remote, parsed) {
  if (parsed.proto === 'HQ') {
    const date = hqDateToYmd(parsed.Date);
    const time = hqTimeToHms(parsed.Time);
    const timestamp = date && time ? `${date}T${time}` : toIsoTimestamp(parsed);

    const latRaw =
      parsed.LAT_DDMM && parsed.LAT_HEMI ? `${parsed.LAT_DDMM} ${parsed.LAT_HEMI}` : null;
    const lonRaw =
      parsed.LON_DDMM && parsed.LON_HEMI ? `${parsed.LON_DDMM} ${parsed.LON_HEMI}` : null;

    return {
      protocol: 'HQ',
      deviceId: parsed.ID != null ? String(parsed.ID) : null,
      version: parsed.VER ?? null,

      time,
      date,
      timestamp,

      gpsStatus: String(parsed.STATUS ?? '').toUpperCase() === 'V' ? 'Valid' : 'Invalid',

      latitude: {
        raw: latRaw,
        decimal: Number(parsed.latitude),
      },
      longitude: {
        raw: lonRaw,
        decimal: Number(parsed.longitude),
      },

      speedKmh: parseSpeedToKmh(parsed.Speed),
      course: parsed.Course != null ? Number(parsed.Course) : null,

      flags: parsed.FLAGS ?? null,

      gsm: {
        mcc: Number.isFinite(parsed.MCC) ? parsed.MCC : null,
        mnc: Number.isFinite(parsed.MNC) ? parsed.MNC : null,
        lac: Number.isFinite(parsed.LAC) ? parsed.LAC : null,
        cellId: Number.isFinite(parsed.CELLID) ? parsed.CELLID : null,
      },

      imei: parsed.IMEI ?? null,

      ...(LOG_RAW ? { raw: parsed.raw } : {}),
    };
  }

  // fallback: keep previous compact schema for ST-901
  const observedAt = toIsoTimestamp(parsed);
  const row = {
    type: 'st901_gps',
    receivedAt: new Date().toISOString(),
    observedAt,
    remote,
    deviceId: parsed.ID != null ? String(parsed.ID) : null,
    latitude: Number(parsed.latitude),
    longitude: Number(parsed.longitude),
    date: parsed.Date,
    time: parsed.Time,
    fix: parsed.FIX,
    speedKmh: parseSpeedToKmh(parsed.Speed),
    battery: parsed.BAT,
    url: parsed.url,
  };
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
      // no frame start (often binary heartbeat). Keep only a small tail to prevent growth.
      return buf.subarray(Math.max(0, buf.length - 256));
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
    const binary = parseBinaryPacket(chunk);
    if (binary) {
      logJson(binary);
    }
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
