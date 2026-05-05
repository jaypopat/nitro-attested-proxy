import { X509Certificate } from "node:crypto";
import type { AttestationDoc } from "./cose.ts";

// https://docs.aws.amazon.com/enclaves/latest/user/verify-root.html
const NITRO_ROOT_FINGERPRINT_SHA256 =
	"64:1A:03:21:A3:E2:44:EF:E4:56:46:31:95:D6:06:31:7E:D7:CD:CC:3C:17:56:E0:98:93:F3:C6:8F:79:BB:5B";

export const ROOT_CERT = new X509Certificate(
	await Bun.file(`${import.meta.dir}/nitro-root.pem`).bytes(),
);
if (ROOT_CERT.fingerprint256 !== NITRO_ROOT_FINGERPRINT_SHA256) {
	throw new Error(`root: fingerprint ${ROOT_CERT.fingerprint256} != pinned`);
}

export type Chain = readonly [X509Certificate, ...X509Certificate[]];

export function buildChain(doc: AttestationDoc): Chain {
	// AWS cabundle: [ROOT, …, INTERM_N]. Validation chain: [LEAF, …, ROOT].
	const leaf = parseCert(doc.certificate, "leaf");
	const intermediates = doc.cabundle
		.map((b, i) => parseCert(b, `cabundle[${i}]`))
		.reverse();
	return [leaf, ...intermediates];
}

// We check signatures, validity windows, and that the terminal cert matches  the pinned root by fingerprint — nothing else. No basicConstraints/keyUsage
// policy checks, since AWS controls every cert in the chain
export function verifyChain(
	chain: Chain,
	root: X509Certificate,
	atTime: Date,
): void {
	if (chain.length < 2) throw new Error("chain: too short");
	for (const cert of chain) assertCertValidAt(cert, atTime);
	for (const [i, child] of chain.entries()) {
		const parent = chain[i + 1];
		if (parent === undefined) break;
		if (!child.verify(parent.publicKey)) {
			throw new Error(`chain: cert[${i}] (${subject(child)}) sig invalid`);
		}
	}
	const terminal = chain.at(-1);
	if (!terminal) throw new Error("chain: empty");
	if (terminal.fingerprint256 !== root.fingerprint256) {
		throw new Error("chain: terminal != pinned root");
	}
}

function parseCert(bytes: Uint8Array, label: string): X509Certificate {
	try {
		return new X509Certificate(bytes);
	} catch (err) {
		throw new Error(`chain: parse ${label}: ${(err as Error).message}`);
	}
}

function assertCertValidAt(cert: X509Certificate, at: Date): void {
	const t = at.getTime();
	if (
		t < new Date(cert.validFrom).getTime() ||
		t > new Date(cert.validTo).getTime()
	) {
		throw new Error(`chain: cert ${subject(cert)} expired`);
	}
}

const subject = (cert: X509Certificate): string =>
	cert.subject.replace(/\n/g, ", ");
