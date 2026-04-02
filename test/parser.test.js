const { test } = require('node:test');
const assert = require('node:assert');
const { parseST901Data, parseMapsUrl, isSt901GpsReport } = require('../lib/parser.js');

test('parseST901Data: full ST-901 style line', () => {
  const raw =
    'http://maps.google.com/maps?q=+17.970767,+102.613425 Date:2006-08-17 Time:04:01:07 ID:9170225361 FIX:V Speed:0KM/H BAT:4';
  const p = parseST901Data(raw);
  assert.strictEqual(p.latitude, 17.970767);
  assert.strictEqual(p.longitude, 102.613425);
  assert.strictEqual(p.Date, '2006-08-17');
  assert.strictEqual(p.Time, '04:01:07');
  assert.strictEqual(p.ID, '9170225361');
  assert.strictEqual(p.FIX, 'V');
  assert.strictEqual(p.Speed, '0KM/H');
  assert.strictEqual(p.BAT, '4');
  assert.ok(!p.parseError);
});

test('parseST901Data: missing Date marker', () => {
  const p = parseST901Data('http://maps.google.com/maps?q=1,2');
  assert.strictEqual(p.parseError, 'no Date: marker found');
});

test('parseMapsUrl: q= with plus signs', () => {
  const c = parseMapsUrl('http://maps.google.com/maps?q=+13.7563,+100.5018');
  assert.deepStrictEqual(c, { lat: 13.7563, lon: 100.5018 });
});

test('isSt901GpsReport: true for valid position', () => {
  const p = parseST901Data(
    'http://maps.google.com/maps?q=+17.97,+102.61 Date:2026-04-02 Time:12:00:00 ID:1 FIX:V Speed:0KM/H BAT:4',
  );
  assert.strictEqual(isSt901GpsReport(p), true);
});

test('isSt901GpsReport: false for HTTP probe / no GPS', () => {
  assert.strictEqual(isSt901GpsReport(parseST901Data('GET / HTTP/1.1')), false);
});

test('isSt901GpsReport: false when coords missing', () => {
  const p = parseST901Data('hello Date:2026-04-02 Time:12:00:00 ID:1');
  assert.strictEqual(isSt901GpsReport(p), false);
});
