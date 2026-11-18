/// <reference lib="es2020" />
/// <reference lib="dom" />
/// <reference lib="dom.iterable" />

declare namespace NodeJS {
  interface ProcessEnv {
    [key: string]: string | undefined;
  }
  interface Process {
    env: ProcessEnv;
    argv: string[];
    cwd(): string;
    exit(code?: number): never;
  }
  type Timeout = ReturnType<typeof setTimeout>;
  interface ReadableStream {
    readable?: boolean;
  }
}

declare var process: NodeJS.Process;

interface Buffer extends Uint8Array {
  toString(encoding?: string, start?: number, end?: number): string;
}

declare var Buffer: {
  from(data: unknown, encoding?: string): Buffer;
  alloc(size: number): Buffer;
  isBuffer(obj: unknown): obj is Buffer;
};
