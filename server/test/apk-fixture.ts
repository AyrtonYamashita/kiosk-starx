/**
 * APK sintético para testes: zip com AndroidManifest.xml binário (AXML) e APK Signing Block v2 com um "certificado"
 * qualquer. Suficiente para o leitor de APK do backend (que não verifica a assinatura criptograficamente; quem
 * verifica é o Android na instalação).
 */
import { deflateRawSync } from 'node:zlib';

const u16 = (n: number) => {
  const b = Buffer.alloc(2);
  b.writeUInt16LE(n);
  return b;
};
const u32 = (n: number) => {
  const b = Buffer.alloc(4);
  b.writeUInt32LE(n >>> 0);
  return b;
};
const u64 = (n: number) => {
  const b = Buffer.alloc(8);
  b.writeBigUInt64LE(BigInt(n));
  return b;
};
const lp = (b: Buffer) => Buffer.concat([u32(b.length), b]);

function manifest(packageName: string, versionCode: number, versionName: string, minSdk: number): Buffer {
  // as 3 primeiras strings têm id de recurso (resource map)
  const strings = ['versionCode', 'versionName', 'minSdkVersion', 'package', 'manifest', 'uses-sdk', packageName, versionName];
  const data = Buffer.concat(
    strings.map((s) => {
      const chars = Buffer.from(s, 'utf16le');
      return Buffer.concat([u16(s.length), chars, u16(0)]);
    }),
  );
  const offsets: number[] = [];
  let o = 0;
  for (const s of strings) {
    offsets.push(o);
    o += 2 + s.length * 2 + 2;
  }
  const padded = Buffer.concat([data, Buffer.alloc((4 - (data.length % 4)) % 4)]);
  const poolHeader = 28;
  const stringsStart = poolHeader + strings.length * 4;
  const pool = Buffer.concat([
    u16(0x0001), u16(poolHeader), u32(stringsStart + padded.length),
    u32(strings.length), u32(0), u32(0), u32(stringsStart), u32(0),
    ...offsets.map(u32),
    padded,
  ]);
  const resMap = Buffer.concat([u16(0x0180), u16(8), u32(8 + 12), u32(0x0101021b), u32(0x0101021c), u32(0x0101020c)]);
  const NONE = 0xffffffff;
  const attr = (name: number, raw: number, type: number, value: number) =>
    Buffer.concat([u32(NONE), u32(name), u32(raw), u16(8), Buffer.from([0, type]), u32(value)]);
  const element = (name: number, attrs: Buffer[]) => {
    const body = Buffer.concat([u32(NONE), u32(name), u16(20), u16(20), u16(attrs.length), u16(0), u16(0), u16(0), ...attrs]);
    return Buffer.concat([u16(0x0102), u16(16), u32(16 + body.length), u32(1), u32(NONE), body]);
  };
  const manifestEl = element(4, [
    attr(0, NONE, 0x10, versionCode), // versionCode (int)
    attr(1, 7, 0x03, 7), // versionName (string)
    attr(3, 6, 0x03, 6), // package (string)
  ]);
  const usesSdk = element(5, [attr(2, NONE, 0x10, minSdk)]);
  const body = Buffer.concat([pool, resMap, manifestEl, usesSdk]);
  return Buffer.concat([u16(0x0003), u16(8), u32(8 + body.length), body]);
}

export function makeTestApk(opts: { packageName: string; versionCode: number; versionName?: string; minSdk?: number; cert?: string }): Buffer {
  const files: [string, Buffer][] = [
    ['AndroidManifest.xml', manifest(opts.packageName, opts.versionCode, opts.versionName ?? `${opts.versionCode}.0`, opts.minSdk ?? 21)],
    ['classes.dex', Buffer.from(`dex ${opts.packageName} ${opts.versionCode}`)],
  ];
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const [name, content] of files) {
    const comp = deflateRawSync(content);
    const n = Buffer.from(name);
    const local = Buffer.concat([u32(0x04034b50), u16(20), u16(0), u16(8), u32(0), u32(0), u32(comp.length), u32(content.length), u16(n.length), u16(0), n, comp]);
    const central = Buffer.concat([
      u32(0x02014b50), u16(20), u16(20), u16(0), u16(8), u32(0), u32(0), u32(comp.length), u32(content.length),
      u16(n.length), u16(0), u16(0), u16(0), u16(0), u32(0), u32(offset), n,
    ]);
    locals.push(local);
    centrals.push(central);
    offset += local.length;
  }
  // "certificado": qualquer DER (SEQUENCE) serve para o leitor; o hash identifica o assinante
  const certBody = Buffer.from(opts.cert ?? 'certificado-de-teste');
  const cert = Buffer.concat([Buffer.from([0x30, certBody.length]), certBody]);
  const signedData = Buffer.concat([lp(Buffer.alloc(0)), lp(lp(cert))]);
  const v2 = lp(lp(lp(signedData)));
  const pair = Buffer.concat([u64(4 + v2.length), u32(0x7109871a), v2]);
  const blockSize = pair.length + 8 + 16;
  const sigBlock = Buffer.concat([u64(blockSize), pair, u64(blockSize), Buffer.from('APK Sig Block 42', 'latin1')]);
  const cdOffset = offset + sigBlock.length;
  const cd = Buffer.concat(centrals);
  const eocd = Buffer.concat([u32(0x06054b50), u16(0), u16(0), u16(files.length), u16(files.length), u32(cd.length), u32(cdOffset), u16(0)]);
  return Buffer.concat([...locals, sigBlock, cd, eocd]);
}
