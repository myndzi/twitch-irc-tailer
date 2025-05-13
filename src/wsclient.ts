// import { WebSocket } from 'ws';
import { TwitchEvent } from './index';
import { FibonacciBackoff } from 'simple-backoff';

const openWebsocket = (url: string, timeout: number): Promise<WebSocket> =>
  new Promise((resolve, reject) => {
    const ws = new WebSocket(url);

    const open = (ev: Event) => {
      cleanup();
      resolve(ws);
    };
    const error = (ev: Event) => {
      cleanup();
      // this is some wack shit. we can't get the reason that a connection
      // failed because apparently the web standard defines this only as
      // an "event", which provides no info to us.
      // node.js uses undici for websockets, and undici makes an ErrorEvent
      // which has the failure reason, but it's not exposed to us in any
      // way so we can't type narrow it or type the event correctly...
      if ('message' in ev) reject(ev.message);
      else reject('unknown error');
    };
    const close = (ev: CloseEvent) => {
      cleanup();
      reject(`closed: ${ev.code} ${ev.reason}`);
    };
    const cleanup = () => {
      ws.removeEventListener('open', open);
      ws.removeEventListener('error', error);
      ws.removeEventListener('close', close);
    };
    ws.addEventListener('open', open);
    ws.addEventListener('error', error);
    ws.addEventListener('close', close);

    setTimeout(() => {
      cleanup();
      reject('timed out');
    }, timeout);
  });

export class WsClient {
  private ws: WebSocket | null = null;
  private backoff: FibonacciBackoff;
  constructor(private url: string, private timeout: number = 5_000) {
    this.backoff = new FibonacciBackoff({
      min: 1_000,
      max: 10_000,
      jitter: 1,
    });
    this.connect();
  }

  private async connect() {
    try {
      console.log('attempting to connect');
      const ws = await openWebsocket(this.url, this.timeout);
      console.log('websocket connected');
      ws.binaryType = 'arraybuffer';
      ws.addEventListener(
        'close',
        ev => {
          console.log(`websocket disconnected: ${ev.code} ${ev.reason}`);
          this.ws = null;
          this.connect();
        },
        { once: true }
      );
      this.ws = ws;
      this.backoff.reset();
    } catch (e) {
      const next = this.backoff.next();
      console.error('failed to connect websocket', e);
      console.log(`trying again in ${next / 1000}s`);
      setTimeout(() => {
        this.connect();
      }, next);
    }
  }

  push(msg: TwitchEvent) {
    // can't send, drop message
    if (this.ws?.readyState !== WebSocket.OPEN) {
      console.error('websocket disconnected, dropping message');
      return;
    }

    const json = JSON.stringify(msg);
    this.ws.send(json);
  }
}
