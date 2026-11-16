import { createHash } from 'node:crypto';
import { inflateRawSync } from 'node:zlib';

/**
 * Leitura de APK sem ferramentas externas (sem aapt): zip → AndroidManifest.xml binário (AXML) e certificado de
 * assinatura (APK Signature Scheme v2/v3; v1/JAR como alternativa para APKs antigos).
 */
export interface ApkInfo {
  packageName: string;
  versionCode: number;
  versionName: string | null;
  minSdk: number | null;
  /** SHA-256 (hex) do certificado de assinatura (DER) do primeiro signatário. */
  signingCertSha256: string;
  signatureScheme: 'v2' | 'v3' | 'v1';
}

export class ApkError extends Error {}

// ---------------------------------------------------------------- zip

interface ZipEntry {
  name: string;
  method: number;
  compressedSize: number;
  size: number;
  localOffset: number;
}

interface Zip {
  entries: Map<string, ZipEntry>;
  centralDirOffset: number;
}

function readZip(buf: Buffer): Zip {
  // EOCD: assinatura 0x06054b50 nos últimos 22 + 65535 bytes (comentário)
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 22 - 0xffff); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new ApkError('não é um arquivo zip/APK');
  const count = buf.readUInt16LE(eocd + 10);
  const cdSize = buf.readUInt32LE(eocd + 12);
  const cdOffset = buf.readUInt32LE(eocd + 16);
  if (cdOffset + cdSize > buf.length) throw new ApkError('zip truncado');

  const entries = new Map<string, ZipEntry>();
  let p = cdOffset;
  for (let n = 0; n < count; n++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new ApkError('diretório do zip inválido');
    const method = buf.readUInt16LE(p + 10);
    const compressedSize = buf.readUInt32LE(p + 20);
    const size = buf.readUInt32LE(p + 24);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const localOffset = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nameLen);
    entries.set(name, { name, method, compressedSize, size, localOffset });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return { entries, centralDirOffset: cdOffset };
}

function readEntry(buf: Buffer, e: ZipEntry): Buffer {
  const h = e.localOffset;
  if (buf.readUInt32LE(h) !== 0x04034b50) throw new ApkError(`entrada ${e.name} inválida`);
  const start = h + 30 + buf.readUInt16LE(h + 26) + buf.readUInt16LE(h + 28);
  const raw = buf.subarray(start, start + e.compressedSize);
  if (e.method === 0) return raw;
  if (e.method === 8) return inflateRawSync(raw, { maxOutputLength: 64 * 1024 * 1024 });
  throw new ApkError(`compressão ${e.method} não suportada em ${e.name}`);
}

// ---------------------------------------------------------------- AXML (manifesto binário)

const ATTR_VERSION_CODE = 0x0101021b;
const ATTR_VERSION_NAME = 0x0101021c;
const ATTR_MIN_SDK = 0x0101020c;
const TYPE_STRING = 0x03;
const TYPE_INT_DEC = 0x10;
const TYPE_INT_HEX = 0x11;
const NO_INDEX = 0xffffffff;

function readStringPool(b: Buffer, at: number): string[] {
  const count = b.readUInt32LE(at + 8);
  const flags = b.readUInt32LE(at + 16);
  const stringsStart = b.readUInt32LE(at + 20);
  const utf8 = (flags & 0x100) !== 0;
  const strings: string[] = [];
  for (let i = 0; i < count; i++) {
    let p = at + stringsStart + b.readUInt32LE(at + 28 + i * 4);
    if (utf8) {
      // dois comprimentos (UTF-16 e UTF-8), cada um com 1 ou 2 bytes
      p += b[p] & 0x80 ? 2 : 1;
      let len = b[p];
      if (len & 0x80) {
        len = ((len & 0x7f) << 8) | b[p + 1];
        p += 2;
      } else p += 1;
      strings.push(b.toString('utf8', p, p + len));
    } else {
      let len = b.readUInt16LE(p);
      if (len & 0x8000) {
        len = ((len & 0x7fff) << 16) | b.readUInt16LE(p + 2);
        p += 4;
      } else p += 2;
      strings.push(b.toString('utf16le', p, p + len * 2));
    }
  }
  return strings;
}

interface ManifestFields {
  packageName: string | null;
  versionCode: number | null;
  versionName: string | null;
  minSdk: number | null;
}

export function parseManifest(b: Buffer): ManifestFields {
  if (b.length < 8 || b.readUInt16LE(0) !== 0x0003) throw new ApkError('AndroidManifest.xml não é XML binário');
  let strings: string[] = [];
  let resIds: number[] = [];
  const out: ManifestFields = { packageName: null, versionCode: null, versionName: null, minSdk: null };
  let p = b.readUInt16LE(2);
  while (p + 8 <= b.length) {
    const type = b.readUInt16LE(p);
    const size = b.readUInt32LE(p + 4);
    if (size < 8) break;
    if (type === 0x0001) strings = readStringPool(b, p);
    else if (type === 0x0180) {
      resIds = [];
      for (let q = p + 8; q < p + size; q += 4) resIds.push(b.readUInt32LE(q));
    } else if (type === 0x0102) {
      const tag = strings[b.readUInt32LE(p + 20)];
      const attrStart = b.readUInt16LE(p + 24);
      const attrSize = b.readUInt16LE(p + 26);
      const attrCount = b.readUInt16LE(p + 28);
      for (let i = 0; i < attrCount; i++) {
        const a = p + 16 + attrStart + i * attrSize;
        const nameIdx = b.readUInt32LE(a + 4);
        const raw = b.readUInt32LE(a + 8);
        const dataType = b[a + 15];
        const data = b.readUInt32LE(a + 16);
        const name = strings[nameIdx];
        const resId = resIds[nameIdx];
        const str = raw !== NO_INDEX ? strings[raw] : dataType === TYPE_STRING ? strings[data] : null;
        const int = dataType === TYPE_INT_DEC || dataType === TYPE_INT_HEX ? data | 0 : str != null && /^\d+$/.test(str) ? Number(str) : null;
        if (tag === 'manifest') {
          if (name === 'package' && !resId) out.packageName = str;
          if (resId === ATTR_VERSION_CODE || name === 'versionCode') out.versionCode = int;
          if (resId === ATTR_VERSION_NAME || name === 'versionName') out.versionName = str;
        } else if (tag === 'uses-sdk' && (resId === ATTR_MIN_SDK || name === 'minSdkVersion')) {
          out.minSdk = int;
        }
      }
      if (tag !== 'manifest' && tag !== 'uses-sdk' && out.packageName) {
        // o resto do manifesto não interessa
        if (tag === 'application') break;
      }
    }
    p += size;
  }
  return out;
}

// ---------------------------------------------------------------- assinatura

const V2_ID = 0x7109871a;
const V3_ID = 0xf05368c0;

/** Primeiro certificado do primeiro signatário no APK Signing Block (v3 tem prioridade sobre v2). */
function signingBlockCert(buf: Buffer, cdOffset: number): { cert: Buffer; scheme: 'v2' | 'v3' } | null {
  if (cdOffset < 32 || buf.toString('latin1', cdOffset - 16, cdOffset) !== 'APK Sig Block 42') return null;
  const blockSize = Number(buf.readBigUInt64LE(cdOffset - 24));
  const start = cdOffset - blockSize - 8;
  if (start < 0) return null;
  const blocks = new Map<number, Buffer>();
  let p = start + 8;
  while (p < cdOffset - 24) {
    const len = Number(buf.readBigUInt64LE(p));
    const id = buf.readUInt32LE(p + 8);
    blocks.set(id, buf.subarray(p + 12, p + 8 + len));
    p += 8 + len;
  }
  for (const [id, scheme] of [[V3_ID, 'v3'], [V2_ID, 'v2']] as const) {
    const v = blocks.get(id);
    if (!v) continue;
    // signers: seq(len) → signer(len) → signedData(len) → digests(len) + certificates(len) → cert(len)
    const lp = (b: Buffer, at: number) => ({ len: b.readUInt32LE(at), body: at + 4 });
    const signers = lp(v, 0);
    const signer = lp(v, signers.body);
    const signedData = lp(v, signer.body);
    const digests = lp(v, signedData.body);
    const certs = lp(v, digests.body + digests.len);
    const cert = lp(v, certs.body);
    return { cert: v.subarray(cert.body, cert.body + cert.len), scheme };
  }
  return null;
}

/** DER: (tag, início do conteúdo, fim). */
function derAt(b: Buffer, at: number): { tag: number; start: number; end: number } {
  const tag = b[at];
  let len = b[at + 1];
  let start = at + 2;
  if (len & 0x80) {
    const n = len & 0x7f;
    len = 0;
    for (let i = 0; i < n; i++) len = len * 256 + b[at + 2 + i];
    start += n;
  }
  return { tag, start, end: start + len };
}

/** v1: PKCS#7 SignedData em META-INF/*.RSA|DSA|EC → primeiro certificado. */
function pkcs7Cert(p7: Buffer): Buffer | null {
  const contentInfo = derAt(p7, 0);
  const oid = derAt(p7, contentInfo.start);
  const explicit = derAt(p7, oid.end);
  const signedData = derAt(p7, explicit.start);
  let p = signedData.start;
  while (p < signedData.end) {
    const el = derAt(p7, p);
    if (el.tag === 0xa0) {
      const cert = derAt(p7, el.start);
      return p7.subarray(el.start, cert.end);
    }
    p = el.end;
  }
  return null;
}

export function parseApk(buf: Buffer): ApkInfo {
  let zip: Zip;
  try {
    zip = readZip(buf);
  } catch (err) {
    if (err instanceof ApkError) throw err;
    throw new ApkError('arquivo zip inválido');
  }
  const manifestEntry = zip.entries.get('AndroidManifest.xml');
  if (!manifestEntry) throw new ApkError('APK sem AndroidManifest.xml');
  let m: ManifestFields;
  try {
    m = parseManifest(readEntry(buf, manifestEntry));
  } catch (err) {
    if (err instanceof ApkError) throw err;
    throw new ApkError('AndroidManifest.xml ilegível');
  }
  if (!m.packageName || !/^[A-Za-z][A-Za-z0-9_]*(\.[A-Za-z][A-Za-z0-9_]*)+$/.test(m.packageName)) throw new ApkError('pacote ausente ou inválido no manifesto');
  if (m.versionCode == null || m.versionCode <= 0) throw new ApkError('versionCode ausente no manifesto');

  let cert: Buffer | null = null;
  let scheme: ApkInfo['signatureScheme'] = 'v1';
  try {
    const block = signingBlockCert(buf, zip.centralDirOffset);
    if (block) ({ cert, scheme } = block);
  } catch {
    cert = null;
  }
  if (!cert) {
    const sig = [...zip.entries.values()].find((e) => /^META-INF\/[^/]+\.(RSA|DSA|EC)$/i.test(e.name));
    if (sig) {
      try {
        cert = pkcs7Cert(readEntry(buf, sig));
      } catch {
        cert = null;
      }
    }
  }
  if (!cert || cert[0] !== 0x30) throw new ApkError('APK sem assinatura (o Android recusaria instalar)');

  return {
    packageName: m.packageName,
    versionCode: m.versionCode,
    versionName: m.versionName,
    minSdk: m.minSdk,
    signingCertSha256: createHash('sha256').update(cert).digest('hex'),
    signatureScheme: scheme,
  };
}
