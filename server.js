const net = require('net');
const { parseST901Data } = require('./lib/parser.js');

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
