import { createReadStream, existsSync, statSync } from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import type { ReadableStream as WebReadableStream } from 'node:stream/web';
import type { Config } from './config.js';
import type { GoldfishAdmin } from './goldfish/admin.js';

const SAFE_NAME = /^[\w.-]{1,120}\.zip$/;
const FALLBACK_NAME = 'goldfish-extension.zip';

export interface ExtensionPackage {
  filename: string;
  length: number | null;
  body: Readable;
}

/**
 * «Ключ подключения» for the side panel of the extension: the address of the Goldfish server and
 * the device token in one value (`gfk_` + base64url of the JSON), so the owner pastes one thing
 * and never sees the address. The extension takes it apart (packages/extension, connectionKey).
 */
export function connectionKey(serverUrl: string, token: string): string {
  return `gfk_${Buffer.from(JSON.stringify({ server: serverUrl, token })).toString('base64url')}`;
}

const safeName = (name: string | undefined) =>
  name && SAFE_NAME.test(name) ? name : FALLBACK_NAME;

/**
 * The extension zip: EXTENSION_ZIP when the file exists, otherwise the package the Goldfish
 * server hands out at /extension/download. Null when there is none.
 */
export async function openExtension(
  config: Pick<Config, 'EXTENSION_ZIP'>,
  goldfish: GoldfishAdmin,
): Promise<ExtensionPackage | null> {
  const local = config.EXTENSION_ZIP;
  if (local && existsSync(local))
    return {
      filename: safeName(path.basename(local)),
      length: statSync(local).size,
      body: createReadStream(local),
    };
  const res = await goldfish.extensionPackage();
  if (!res.ok || !res.body) {
    await res.body?.cancel();
    return null;
  }
  const length = Number(res.headers.get('content-length'));
  return {
    filename: safeName(
      /filename="?([^";]+)"?/i.exec(res.headers.get('content-disposition') ?? '')?.[1],
    ),
    length: Number.isFinite(length) && length > 0 ? length : null,
    body: Readable.fromWeb(res.body as WebReadableStream<Uint8Array>),
  };
}
