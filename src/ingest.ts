import { WebSocket, WebSocketServer } from 'ws';
import { LRUCache, Heap } from 'mnemonist';
import { TokenBucket } from 'simple-token-bucket';
import { createServer, IncomingMessage } from 'http';
import { TwitchEvent } from './index';
import { OrderedMap } from './orderedmap';

const MAX_CONCURRENT = 100;
const WINDOW_SIZE = 1_000;

type RequireKeys<T extends {}, Ks extends keyof T> = Omit<T, Ks> & Required<Pick<T, Ks>>;

type MinTwitchEvent = RequireKeys<TwitchEvent, 'id' | 'ts'>;
type MultiEvent = {
  id: string;
  maxTs: number;
  msgs: MinTwitchEvent | MinTwitchEvent[];
};

const isComplete = (msg: TwitchEvent): msg is MinTwitchEvent =>
  typeof msg.id === 'string' && typeof msg.ts === 'number';

const combine = (a: MultiEvent, b: MultiEvent): MultiEvent => ({
  id: a.id, // same as b.id
  maxTs: Math.max(a.maxTs, b.maxTs),
  msgs: (Array.isArray(a.msgs) ? a.msgs : [a.msgs]).concat(b.msgs),
});

let newestMsg: number = 0;

const events = new OrderedMap(combine, 'id', 'maxTs');
const format = (msg: TwitchEvent): string => {
  const strs: string[] = [new Date(msg.ts).toISOString(), `[${msg.name}]`];
  const user = msg.user?.login ?? msg.user?.displayName ?? null;
  if (user !== null) strs.push(`<${user}>`);
  if (msg.args) {
    for (const [k, v] of Object.entries(msg.args)) {
      strs.push(`${k}=${typeof v === 'object' ? JSON.stringify(v) : v}`);
    }
  }
  return strs.join(' ');
};

setInterval(() => {
  // if we're not receiving new data, lag behind twitch timestamps by a second
  if (newestMsg < Date.now() - WINDOW_SIZE * 2) newestMsg += WINDOW_SIZE;

  const cutoff = newestMsg - WINDOW_SIZE;

  events.process(item => {
    if (item.maxTs > cutoff) return item;

    const count = Array.isArray(item.msgs) ? item.msgs.length : 1;
    const msgStrs = Array.isArray(item.msgs) ? item.msgs.map(format) : [format(item.msgs)];

    console.log(`(${count.toString().padStart(3, ' ')}) [${item.id}]`);
    for (const str of msgStrs) {
      console.log(`      ${str}`);
    }
  });
}, WINDOW_SIZE).unref();

const bucketsByIp = new LRUCache<string, TokenBucket>(MAX_CONCURRENT * 10);

enum RejectReason {
  UNKNOWN_SOURCE_ADDRESS = 100,
  RATE_LIMITED,
  TOO_MANY_CONNECTIONS,
}

const sessions = new Map<WebSocket, boolean>();

const canConnect = (req: IncomingMessage): RejectReason | null => {
  if (sessions.size >= MAX_CONCURRENT) return RejectReason.TOO_MANY_CONNECTIONS;

  const ip = req.socket.remoteAddress;
  if (!ip) return RejectReason.UNKNOWN_SOURCE_ADDRESS;

  const bucket =
    bucketsByIp.get(ip) ??
    new TokenBucket({
      capacity: 5,
      fillQuantity: 1,
      fillTime: 10_000,
      initialCapacity: 5,
    });
  bucketsByIp.set(ip, bucket);

  if (bucket.take(1) > 0) return RejectReason.RATE_LIMITED;

  return null;
};

const server = createServer();
const wss = new WebSocketServer({
  noServer: true,
});

const decoder = new TextDecoder('utf-8');

wss.on('connection', (ws, req) => {
  ws.binaryType = 'arraybuffer';

  sessions.set(ws, true);

  ws.on('message', data => {
    sessions.set(ws, true);

    const str = decoder.decode(data as Uint8Array);
    try {
      const json: TwitchEvent = JSON.parse(str);
      if (!isComplete(json)) return;
      const { id, ts } = json;
      newestMsg = Math.max(newestMsg, ts);
      events.add({ id, maxTs: ts, msgs: json });
      // console.log(`pushed message ts=${ts} id=${id}`);
    } catch (e) {
      console.error('invalid websocket message', str, e);
    }
  });

  ws.on('pong', () => {
    sessions.set(ws, true);
  });

  ws.on('close', () => {
    sessions.delete(ws);
  });

  ws.send('something');
});

setInterval(() => {
  for (const [ws, isAlive] of sessions) {
    if (!isAlive) {
      ws.terminate();
    } else {
      sessions.set(ws, false);
      ws.ping();
    }
  }
}, 30_000).unref();

server.on('upgrade', (req, socket, head) => {
  const rejectReason = canConnect(req);
  if (rejectReason !== null) {
    let code_msg: string = '500 Unknown Error';
    switch (rejectReason) {
      case RejectReason.UNKNOWN_SOURCE_ADDRESS:
        code_msg = '401 Unauthorized';
        break;
      case RejectReason.RATE_LIMITED:
        code_msg = '429 Too Many Requests';
        break;
      case RejectReason.TOO_MANY_CONNECTIONS:
        code_msg = '503 Service Unavailable';
        break;
    }

    console.log(`rejecting connection from ${req.socket.remoteAddress}: ${code_msg}`);
    socket.write(`HTTP/1.1 ${code_msg}\r\n\r\n`);
    socket.end();
  }

  wss.handleUpgrade(req, socket, head, ws => {
    wss.emit('connection', ws, req);
  });
});

server.on('error', e => {
  console.log('server error', e);
});
server.listen(8410, () => {
  console.log('listening');
});

let interrupted = false;
process.on('SIGINT', () => {
  if (interrupted) process.exit(1);
  interrupted = true;
  server.close();
  server.closeAllConnections();
});
