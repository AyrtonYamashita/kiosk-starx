import crypto from "node:crypto";

/**
 * Autenticador de software para os testes (faz o papel do Windows Hello/Touch ID): chave ES256 (P-256), atestado
 * "none", respostas no formato JSON que o navegador (@simplewebauthn/browser) entrega à API.
 */

// ---------------------------------------------------------------- CBOR mínimo (inteiros, bytes, texto, mapas)
function head(major: number, n: number): Buffer {
  if (n < 24) return Buffer.from([(major << 5) | n]);
  if (n < 256) return Buffer.from([(major << 5) | 24, n]);
  const b = Buffer.alloc(3);
  b[0] = (major << 5) | 25;
  b.writeUInt16BE(n, 1);
  return b;
}
type Cbor = number | string | Buffer | Map<number | string, Cbor>;
function cbor(v: Cbor): Buffer {
  if (Buffer.isBuffer(v)) return Buffer.concat([head(2, v.length), v]);
  if (typeof v === "string") {
    const s = Buffer.from(v, "utf8");
    return Buffer.concat([head(3, s.length), s]);
  }
  if (typeof v === "number") return v >= 0 ? head(0, v) : head(1, -1 - v);
  const parts: Buffer[] = [head(5, v.size)];
  for (const [k, val] of v) parts.push(cbor(k), cbor(val));
  return Buffer.concat(parts);
}

const b64u = (b: Buffer) => b.toString("base64url");
const sha256 = (b: Buffer | string) => crypto.createHash("sha256").update(b).digest();

export class SoftAuthenticator {
  readonly credentialId = crypto.randomBytes(16);
  private readonly keys = crypto.generateKeyPairSync("ec", { namedCurve: "P-256" });
  private userHandle = "";
  counter = 0;

  constructor(
    public rpId = "localhost",
    public origin = "http://localhost:3000",
  ) {}

  get id() {
    return b64u(this.credentialId);
  }

  private authData(flags: number, extra?: Buffer, rpId = this.rpId) {
    const c = Buffer.alloc(4);
    c.writeUInt32BE(this.counter);
    return Buffer.concat([sha256(rpId), Buffer.from([flags]), c, ...(extra ? [extra] : [])]);
  }

  private clientData(type: string, challenge: string, origin = this.origin) {
    return Buffer.from(JSON.stringify({ type, challenge, origin, crossOrigin: false }));
  }

  /** navigator.credentials.create */
  create(options: { challenge: string; user: { id: string } }) {
    this.userHandle = options.user.id;
    const jwk = this.keys.publicKey.export({ format: "jwk" });
    const cose = cbor(
      new Map<number, Cbor>([
        [1, 2], // kty: EC2
        [3, -7], // alg: ES256
        [-1, 1], // crv: P-256
        [-2, Buffer.from(jwk.x!, "base64url")],
        [-3, Buffer.from(jwk.y!, "base64url")],
      ]),
    );
    const len = Buffer.alloc(2);
    len.writeUInt16BE(this.credentialId.length);
    const attested = Buffer.concat([Buffer.alloc(16), len, this.credentialId, cose]);
    const authData = this.authData(0x01 | 0x04 | 0x40, attested); // UP | UV | AT
    const attestationObject = cbor(
      new Map<string, Cbor>([
        ["fmt", "none"],
        ["attStmt", new Map()],
        ["authData", authData],
      ]),
    );
    return {
      id: this.id,
      rawId: this.id,
      type: "public-key" as const,
      response: {
        clientDataJSON: b64u(this.clientData("webauthn.create", options.challenge)),
        attestationObject: b64u(attestationObject),
        transports: ["internal"],
      },
      clientExtensionResults: {},
      authenticatorAttachment: "platform" as const,
    };
  }

  /** navigator.credentials.get — opções para simular ataques (origem/domínio errado, sem biometria, contador). */
  get(options: { challenge: string }, o: { origin?: string; rpId?: string; userVerified?: boolean; counter?: number } = {}) {
    this.counter = o.counter ?? this.counter + 1;
    const authData = this.authData(0x01 | (o.userVerified === false ? 0 : 0x04), undefined, o.rpId ?? this.rpId);
    const clientDataJSON = this.clientData("webauthn.get", options.challenge, o.origin);
    const signature = crypto.sign("sha256", Buffer.concat([authData, sha256(clientDataJSON)]), this.keys.privateKey);
    return {
      id: this.id,
      rawId: this.id,
      type: "public-key" as const,
      response: {
        clientDataJSON: b64u(clientDataJSON),
        authenticatorData: b64u(authData),
        signature: b64u(signature),
        userHandle: this.userHandle,
      },
      clientExtensionResults: {},
      authenticatorAttachment: "platform" as const,
    };
  }
}
