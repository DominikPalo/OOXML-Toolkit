import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { OOXML_EXTENSIONS } from '@shared/api';

const root = resolve(__dirname, '..');
const read = (p: string): string => readFileSync(resolve(root, p), 'utf8');

describe('Tauri host', () => {
  it('accepts the same extensions from the command line as the renderer', () => {
    const src = read('src-tauri/src/main.rs');
    const list = /const EXTENSIONS: &\[&str\] = &\[([^\]]*)\]/.exec(src)?.[1] ?? '';
    const rust = [...list.matchAll(/"([^"]+)"/g)].map((m) => m[1]);
    expect(rust).toEqual(OOXML_EXTENSIONS);
  });

  it('registers the same file associations as electron-builder', () => {
    const conf = JSON.parse(read('src-tauri/tauri.conf.json')) as {
      bundle: { fileAssociations: Array<{ ext: string[] }> };
    };
    const tauri = conf.bundle.fileAssociations.flatMap((a) => a.ext);
    const electron = [...read('electron-builder.yml').matchAll(/\{ ext: (\w+),/g)].map((m) => m[1]);
    expect(tauri).toEqual(electron);
  });
});
