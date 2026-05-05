// Communication - JSONL objects over TLS
//
//   request:  {"mode":"attest","nonce":"<b64-32B>"}
//             {"mode":"send","enc":"<b64-32B>","ct":"<b64>"}
//   response: {"ok":"<b64>"} | {"error":"<msg>","code":"<symbol>"}

import { connect } from "bun";
import { z } from "zod";
import { sealRequest } from "../crypto";
import { type AttestationDoc, verifyAttestation } from "../verify";

export type AttestedClientOptions = {
	host: string;
	port?: number;
	timeoutMs?: number;
};

const DEFAULT_PORT = 8000;

type Request =
	| { mode: "attest"; nonce: string }
	| { mode: "send"; enc: string; ct: string };

const ResponseSchema = z.union([
	z.object({ ok: z.string() }),
	z.object({ error: z.string(), code: z.string().optional() }),
]);

export class AttestedClient {
	private constructor(
		private readonly opts: AttestedClientOptions,
		private readonly _doc: AttestationDoc,
	) {}

	// Attests once and caches the doc as a pubkey container for the life
	// of the client; the static X25519 keypair never rotates, so re-attesting adds no security.
	static async open(opts: AttestedClientOptions): Promise<AttestedClient> {
		const doc = await fetchAttestation(opts);
		return new AttestedClient(opts, doc);
	}

	get doc(): AttestationDoc {
		return this._doc;
	}

	get pcr0Hex(): string {
		return Buffer.from(this._doc.pcrs.get(0) ?? []).toString("hex");
	}

	async send(
		message: string | Uint8Array<ArrayBuffer>,
	): Promise<Uint8Array<ArrayBuffer>> {
		if (!this._doc.public_key) {
			throw new Error(
				"attestation: public_key missing — enclave didn't bind one",
			);
		}
		const bytes =
			typeof message === "string" ? new TextEncoder().encode(message) : message;
		const sealed = await sealRequest(this._doc.public_key, bytes);
		const respCt = await jsonRequest(this.opts, {
			mode: "send",
			enc: Buffer.from(sealed.enc).toString("base64"),
			ct: Buffer.from(sealed.ciphertext).toString("base64"),
		});
		return await sealed.openResponse(new Uint8Array(respCt));
	}
}

async function fetchAttestation(
	opts: AttestedClientOptions,
): Promise<AttestationDoc> {
	const nonce = crypto.getRandomValues(new Uint8Array(32));
	const cbor = await jsonRequest(opts, {
		mode: "attest",
		nonce: Buffer.from(nonce).toString("base64"),
	});
	return verifyAttestation(new Uint8Array(cbor), nonce);
}

async function jsonRequest(
	opts: AttestedClientOptions,
	body: Request,
): Promise<Buffer> {
	const respBuf = await tcpRequest(opts, `${JSON.stringify(body)}\n`);
	const records = Bun.JSONL.parse(respBuf);
	if (records.length !== 1) {
		throw new Error(`enclave: expected 1 record, got ${records.length}`);
	}
	let env: z.infer<typeof ResponseSchema>;
	try {
		env = ResponseSchema.parse(records[0]);
	} catch (err) {
		throw new Error(`enclave: bad response shape: ${(err as Error).message}`);
	}
	if ("error" in env) {
		throw new Error(`enclave: ${env.error} [${env.code ?? "unknown"}]`);
	}
	return Buffer.from(env.ok, "base64");
}

// Single-shot: connection close frames the response.
async function tcpRequest(
	opts: AttestedClientOptions,
	request: string | Uint8Array,
): Promise<Buffer> {
	const timeoutMs = opts.timeoutMs ?? 5000;
	const chunks: Uint8Array[] = [];
	const { promise, resolve, reject } = Promise.withResolvers<void>();
	const timer = setTimeout(
		() => reject(new Error(`network: timeout ${timeoutMs}ms`)),
		timeoutMs,
	);

	await connect({
		hostname: opts.host,
		port: opts.port ?? DEFAULT_PORT,
		socket: {
			open(socket) {
				socket.write(request);
			},
			data(_socket, data) {
				chunks.push(new Uint8Array(data));
			},
			close() {
				clearTimeout(timer);
				resolve();
			},
			error(_socket, err) {
				clearTimeout(timer);
				reject(new Error(`network: ${err.message}`));
			},
		},
	});

	await promise;
	return Buffer.concat(chunks);
}
