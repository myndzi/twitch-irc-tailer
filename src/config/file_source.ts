import { readFile, writeFile } from 'node:fs/promises';
import { basename } from 'node:path';

import { StaticDecode, StaticEncode, TSchema } from '@sinclair/typebox';
import { TransformEncodeCheckError, Value } from '@sinclair/typebox/value';
import { Immutable, produce } from 'immer';
import { format } from 'prettier';

export class FileSource<T extends TSchema> {
  readonly filename: string;
  private abspath: string;
  private schema: T;
  private data: StaticDecode<T>;

  private constructor(abspath: string, schema: T) {
    this.abspath = abspath;
    this.filename = basename(abspath);
    this.schema = schema;
    this.data = undefined as any;
  }

  public static async from<T extends TSchema>(abspath: string, schema: T): Promise<FileSource<T>> {
    const fs = new FileSource(abspath, schema);
    await fs.load();
    return fs;
  }

  private async read(): Promise<StaticDecode<T>> {
    const fileData = await readFile(this.abspath, 'utf-8');
    const parsed = JSON.parse(fileData);
    if (!Value.Check(this.schema, parsed)) {
      const strs = [`File ${this.abspath} failed schema validation:`];
      for (const err of Value.Errors(this.schema, parsed)) {
        strs.push(`=>  ${err.path}: ${err.message}`);
      }
      throw new Error(strs.join('\n') + '\n');
    }
    const decoded = Value.Decode(this.schema, parsed);
    return decoded;
  }

  private async load(): Promise<void> {
    this.data ??= await this.read();
  }

  private async write(data: StaticEncode<T>): Promise<void> {
    const str = await format(JSON.stringify(data), { parser: 'json' });
    await writeFile(this.abspath, str);
  }

  public get(): StaticDecode<T> {
    return this.data;
  }

  public async update(cb: (data: StaticDecode<T>) => void | Immutable<StaticDecode<T>>) {
    try {
      // let immer take care of ensuring nothing gets mutated when it shouldn't :)
      const newData = produce(this.data, cb);

      // nothing changed
      if (this.data === newData) return;

      const encoded: StaticEncode<T> = Value.Encode(this.schema, newData);
      if (!Value.Check(this.schema, encoded)) {
        console.error('FileSource.update: failed to validate the updated data');
        for (const err of Value.Errors(this.schema, encoded)) {
          console.error(`${err.path}: ${err.message}`);
        }
        return;
      }

      console.info('updating', basename(this.abspath));
      this.data = newData;
      await this.write(encoded);
    } catch (e) {
      if (e instanceof TransformEncodeCheckError) {
        console.error(
          'FileSource.update: failed to encode the updated data',
          e.message,
          `${e.error.path}: ${e.error.message}`
        );
      } else {
        console.error('FileSource.update: failed to encode the updated data', e instanceof Error ? e : String(e));
      }
      return;
    }
  }
}
