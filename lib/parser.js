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

/** True when parse looks like an ST-901 position line (coords + no parse error). */
function isSt901GpsReport(parsed) {
  if (!parsed || parsed.parseError) return false;
  const lat = parsed.latitude;
  const lon = parsed.longitude;
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return false;
  if (lat < -90 || lat > 90 || lon < -180 || lon > 180) return false;
  return true;
}

module.exports = { parseST901Data, parseMapsUrl, isSt901GpsReport };
