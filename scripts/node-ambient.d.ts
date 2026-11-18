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
    loadEnvFile?(path?: string): void;
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

declare module 'node:fs' {
  export interface FileStats {
    size: number;
    isFile(): boolean;
  }
  export function existsSync(filePath: string): boolean;
  export function readFileSync(filePath: string, encoding: 'utf8' | 'utf-8'): string;
  export function readFileSync(filePath: string): Buffer;
  export function statSync(filePath: string): FileStats;
}

declare module 'node:path' {
  export function extname(filePath: string): string;
  export function basename(filePath: string): string;
  export function resolve(...pathSegments: string[]): string;
}
