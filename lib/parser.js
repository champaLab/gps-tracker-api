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

/**
 * Parse `ddmm.mmmm` (lat) / `dddmm.mmmm` (lon) into decimal degrees.
 * Example: 1758.4584,N => 17 + 58.4584/60
 */
function parseDdmmToDecimal(ddmm, hemi) {
  const v = Number(ddmm);
  if (!Number.isFinite(v)) return null;
  const deg = Math.floor(v / 100);
  const minutes = v - deg * 100;
  const decimal = deg + minutes / 60;
  if (!Number.isFinite(decimal)) return null;
  const h = String(hemi ?? '').toUpperCase();
  if (h === 'S' || h === 'W') return -decimal;
  return decimal;
}

/**
 * HQ tracker line, e.g.:
 * *HQ,9170225361,V6,062438,V,1758.4584,N,10236.9522,E,0.00,0.00,020426,...,#
 */
function parseHqData(raw) {
  const result = { raw };
  try {
    // Keep only printable part up to '#'
    const hash = raw.indexOf('#');
    const head = (hash >= 0 ? raw.slice(0, hash + 1) : raw).trim();

    const star = head.lastIndexOf('*');
    const frame = (star >= 0 ? head.slice(star) : head).trim();

    if (!frame.startsWith('*HQ')) {
      result.parseError = 'not_hq_frame';
      return result;
    }

    const payload = frame.replace(/\s+/g, '');
    const trimmed = payload.endsWith('#') ? payload.slice(0, -1) : payload;
    const parts = trimmed.split(',');

    // minimal shape: *HQ,IMEI,VER,TIME,STATUS,LAT,NS,LON,EW,SPEED,COURSE,DATE,...
    if (parts.length < 12) {
      result.parseError = 'hq_too_short';
      return result;
    }

    result.proto = 'HQ';
    result.ID = parts[1];
    result.VER = parts[2];
    result.Time = parts[3];
    result.STATUS = parts[4];
    const lat = parseDdmmToDecimal(parts[5], parts[6]);
    const lon = parseDdmmToDecimal(parts[7], parts[8]);
    if (lat != null) result.latitude = lat;
    if (lon != null) result.longitude = lon;
    result.Speed = parts[9];
    result.Course = parts[10];
    result.Date = parts[11];
  } catch (err) {
    result.parseError = err.message;
  }
  return result;
}

/** True when parse looks like an ST-901 position line (coords + no parse error). */
function isSt901GpsReport(parsed) {
  if (!parsed || parsed.parseError) return false;
  const lat = parsed.latitude;
  const lon = parsed.longitude;
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return false;
  if (lat < -90 || lat > 90 || lon < -180 || lon > 180) return false;
  return true;
}

module.exports = {
  parseST901Data,
  parseMapsUrl,
  parseDdmmToDecimal,
  parseHqData,
  isSt901GpsReport,
};
