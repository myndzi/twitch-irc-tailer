import { TwitchEvent } from '.';

export default 0;

class Node<T> {
  prev: Node<T> | null = null;
  next: Node<T> | null = null;
  constructor(public item: T, public order: number) {}
}

type NumericValues<T> = { [K in keyof T]: T[K] extends number ? K : never }[keyof T];

export class OrderedMap<K extends keyof T, T extends { [K in keyof T]: T[K] }> {
  private head: Node<T> | null = null;
  private tail: Node<T> | null = null;
  private lookup: Map<T[K], Node<T>> = new Map();

  constructor(private merge: (left: T, right: T) => T, private key: K, private order: keyof T & NumericValues<T>) {}

  private setHead(node: Node<T>) {
    node.prev = null;
    node.next = this.head;
    if (this.head) this.head.prev = node;
    this.head = node;
    return;
  }

  private setTail(node: Node<T>) {
    node.next = null;
    node.prev = this.tail;
    if (this.tail) this.tail.next = node;
    this.tail = node;
  }

  private insertRightOf(node: Node<T>, left: Node<T>) {
    // put ourselves between left and left's next
    node.next = left.next;
    node.prev = left;
    if (left.next) {
      left.next.prev = node;
    } else {
      this.tail = node;
    }
    left.next = node;
  }

  private moveLeft(node: Node<T>): boolean {
    let left: Node<T> | null = node.prev;
    if (left === null) return false;

    // seek left while left is greater than node
    while (left !== null && left.order > node.order) {
      left = left.prev;
    }

    if (left === node) return false;

    this.unlink(node);
    if (left === null) {
      // if left is null we should be first
      this.setHead(node);
    } else {
      this.insertRightOf(node, left);
    }

    return true;
  }

  private moveRight(node: Node<T>): boolean {
    let left: Node<T> | null = node.next;
    if (left === null) return false;

    // seek right while right is less than node
    while (left !== null && left.order < node.order) {
      left = left.next;
    }

    if (left === node) return false;

    this.unlink(node);
    if (left === null) {
      // if left is null we should be last
      this.setTail(node);
    } else {
      this.insertRightOf(node, left);
    }

    return true;
  }

  add(item: T): void {
    const key = item[this.key];

    const exist = this.lookup.get(key);
    if (exist !== undefined) {
      // there's an item matching the key; update and reorder
      exist.item = this.merge(exist.item, item);
      this.moveLeft(exist) || this.moveRight(exist);
      return;
    }

    // it's a new item...
    const node: Node<T> = {
      prev: null,
      next: null,
      order: item[this.order],
      item,
    };

    this.lookup.set(key, node);
    if (this.tail === null) {
      // ... it's the only item, nothing more to do ...
      this.head = this.tail = node;
      return;
    }

    // ... append it and move left
    this.tail.next = node;
    node.prev = this.tail;
    this.tail = node;
    this.moveLeft(node);
  }

  peek(): T | undefined {
    return this.head?.item ?? undefined;
  }

  shift(): T | undefined {
    if (this.head === null) return;
    const node = this.head;
    this.lookup.delete(node.item[this.key]);
    if (node.next) node.next.prev = null;
    this.head = node.next;

    return node.item;
  }

  unlink(node: Node<T>) {
    if (node.prev) node.prev.next = node.next;
    if (node.next) node.next.prev = node.prev;

    if (node === this.head) this.head = node.next;
    if (node === this.tail) this.tail = node.prev;
  }

  items(): T[] {
    const arr: T[] = new Array(this.lookup.size);
    let node: Node<T> | null = this.head;
    let i = 0;
    while (node !== null) {
      arr[i++] = node.item;
      node = node.next;
    }
    return arr;
  }

  private dropHead() {
    if (this.head === null) return;
    const node = this.head;
    this.head = node.next;
    if (node.next) {
      node.next.prev = null;
    } else {
      this.tail = null;
    }
  }

  process(fn: (item: T) => void | T) {
    let i = 0;
    while (this.head !== null) {
      const item = this.head.item;
      if (fn(item) === item) break;
      i++;
      this.dropHead();
    }
  }
}

const foo = new OrderedMap(
  (left: TwitchEvent, right: TwitchEvent): TwitchEvent => ({
    ...left,
    name: `${left.name} ${right.name}`,
  }),
  'id',
  'ts'
);

foo.add({
  name: 'test',
  id: 'foo',
  ts: 34,
});
foo.add({
  name: 'test',
  id: 'bar',
  ts: 32,
});
foo.add({
  name: 'test',
  id: 'bar',
  ts: 34,
});
