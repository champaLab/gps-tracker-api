const net = require('net');

const HOST = process.env.HOST ?? '0.0.0.0';
const PORT = Number(process.env.PORT ?? 1122);

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
      console.log('Raw data:', rawData);

      const parsed = parseST901Data(rawData);
      console.log('Parsed data:', JSON.stringify(parsed, null, 2));
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

/**
 * ST-901 style line, e.g.:
 * http://maps.google.com/maps?q=+17.970767,+102.613425 Date:2006-08-17 Time:04:01:07 ID:9170225361 FIX:V Speed:0KM/H BAT:4
 */
function parseST901Data(raw) {
  const result = { raw };

  try {
    const dateMarker = ' Date:';
    const idx = raw.indexOf(dateMarker);
    if (idx === -1) {
      result.parseError = 'no Date: marker found';
      return result;
    }

    const urlPart = raw.slice(0, idx).trim();
    const afterDate = raw.slice(idx + dateMarker.length).trim();

    result.url = urlPart;

    const coords = parseMapsUrl(urlPart);
    if (coords) {
      result.latitude = coords.lat;
      result.longitude = coords.lon;
    }

    const spaceIdx = afterDate.indexOf(' ');
    const dateValue = spaceIdx === -1 ? afterDate : afterDate.slice(0, spaceIdx);
    const tail = spaceIdx === -1 ? '' : afterDate.slice(spaceIdx + 1).trim();

    result.Date = dateValue;

    if (tail) {
      tail.split(/\s+/).forEach((item) => {
        const colon = item.indexOf(':');
        if (colon <= 0) return;
        const key = item.slice(0, colon).trim();
        const value = item.slice(colon + 1).trim();
        if (key) result[key] = value;
      });
    }
  } catch (err) {
    result.parseError = err.message;
    console.error('Parse error:', err);
  }

  return result;
}

function parseMapsUrl(url) {
  const m = url.match(/[?&]q=\+?([+-]?\d+\.?\d*),\s*\+?([+-]?\d+\.?\d*)/i);
  if (!m) return null;
  const lat = Number(m[1]);
  const lon = Number(m[2]);
  if (Number.isNaN(lat) || Number.isNaN(lon)) return null;
  return { lat, lon };
}
