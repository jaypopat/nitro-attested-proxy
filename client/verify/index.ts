import { timingSafeEqual, type X509Certificate } from "node:crypto";
import { buildChain, ROOT_CERT, verifyChain } from "./chain.ts";
import {
	type AttestationDoc,
	parseCose,
	parseDoc,
	verifyCoseSignature,
} from "./cose.ts";

export type { AttestationDoc } from "./cose.ts";

const pinned = (await Bun.file(
	`${import.meta.dir}/pinned-pcrs.json`,
).json()) as { PCR0: string };
const PINNED_PCR0 = Buffer.from(pinned.PCR0, "hex");

const DEFAULT_SKEW_MS = 5 * 60 * 1000;

export type VerifyOpts = {
	skipNonce?: boolean;
	skipPcr0?: boolean;
	skipTimestamp?: boolean;
	now?: Date;
	pinnedPcr0?: Uint8Array;
	root?: X509Certificate;
};

export function verifyAttestation(
	cbor: Uint8Array,
	expectedNonce: Uint8Array | undefined,
	opts: VerifyOpts = {},
): AttestationDoc {
	const cose = parseCose(cbor);
	const doc = parseDoc(cose.payload);

	if (!opts.skipNonce) checkNonce(doc, expectedNonce);
	if (!opts.skipTimestamp) checkTimestamp(doc, opts.now);

	const chain = buildChain(doc);
	const [leaf] = chain;
	verifyChain(chain, opts.root ?? ROOT_CERT, new Date(doc.timestamp));
	verifyCoseSignature(cose, leaf);

	if (!opts.skipPcr0) checkPcr0(doc, opts.pinnedPcr0 ?? PINNED_PCR0);
	return doc;
}

function checkNonce(
	doc: AttestationDoc,
	expected: Uint8Array | undefined,
): void {
	if (!expected) throw new Error("nonce: no expected nonce provided");
	if (!doc.nonce) throw new Error("nonce: doc.nonce missing");
	if (!timingSafeEqual(doc.nonce, expected)) {
		throw new Error("nonce: value mismatch");
	}
}

function checkTimestamp(
	doc: AttestationDoc,
	now: Date = new Date(),
	skewMs = DEFAULT_SKEW_MS,
): void {
	const delta = now.getTime() - doc.timestamp;
	if (Math.abs(delta) > skewMs) {
		throw new Error(`timestamp: ${delta}ms off (skew ${skewMs}ms)`);
	}
}

function checkPcr0(doc: AttestationDoc, expected: Uint8Array): void {
	const pcr0 = doc.pcrs.get(0);
	if (pcr0?.length !== expected.length || !timingSafeEqual(pcr0, expected)) {
		const got = pcr0 ? Buffer.from(pcr0).toString("hex") : "(missing)";
		throw new Error(
			`pcr0: value mismatch: ${got} != ${Buffer.from(expected).toString("hex")}`,
		);
	}
}
