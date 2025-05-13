declare module 'simple-backoff' {
  export class FibonacciBackoff {
    constructor({ min: number, max: number, jitter: number });
    reset(): void;
    next(): number;
  }
}
