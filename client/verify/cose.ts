import { verify, type X509Certificate } from "node:crypto";
import { decode, encode, Tag } from "cbor2";
import { z } from "zod";

const Bytes = z.instanceof(Uint8Array);
const OptBytes = Bytes.nullish().transform((v) => v ?? undefined);

const AttestationDocSchema = z.object({
	module_id: z.string(),
	digest: z.literal("SHA384"),
	timestamp: z.union([z.number(), z.bigint()]).transform(Number),
	pcrs: z.map(z.number(), Bytes),
	certificate: Bytes,
	cabundle: z.array(Bytes),
	public_key: OptBytes,
	user_data: OptBytes,
	nonce: OptBytes,
});

const CoseSign1Schema = z.tuple([
	Bytes,
	z.map(z.unknown(), z.unknown()),
	Bytes,
	Bytes,
]);

export type AttestationDoc = z.infer<typeof AttestationDocSchema>;

export type Cose = {
	protected: Uint8Array;
	payload: Uint8Array;
	signature: Uint8Array;
};

export function parseCose(cbor: Uint8Array): Cose {
	let outer: unknown;
	try {
		outer = decode<unknown>(cbor, { preferMap: true });
	} catch (err) {
		throw new Error(`parse: COSE_Sign1 cbor: ${(err as Error).message}`);
	}
	const arr = outer instanceof Tag ? outer.contents : outer;
	const r = CoseSign1Schema.safeParse(arr);
	if (!r.success) {
		const i = r.error.issues[0];
		throw new Error(
			`parse: COSE_Sign1.${i?.path.join(".") || "(root)"}: ${i?.message ?? "invalid"}`,
		);
	}
	const [protected_, , payload, signature] = r.data;
	return { protected: protected_, payload, signature };
}

export function parseDoc(payloadBytes: Uint8Array): AttestationDoc {
	let m: Map<string, unknown>;
	try {
		m = decode<Map<string, unknown>>(payloadBytes, { preferMap: true });
	} catch (err) {
		throw new Error(`parse: AttestationDoc cbor: ${(err as Error).message}`);
	}
	const r = AttestationDocSchema.safeParse(Object.fromEntries(m));
	if (!r.success) {
		const i = r.error.issues[0];
		throw new Error(
			`parse: AttestationDoc.${i?.path.join(".") || "(root)"}: ${i?.message ?? "invalid"}`,
		);
	}
	return r.data;
}

export function verifyCoseSignature(cose: Cose, leaf: X509Certificate): void {
	const sigStructure = encode([
		"Signature1",
		cose.protected,
		new Uint8Array(0),
		cose.payload,
	]);
	const ok = verify(
		"sha384",
		sigStructure,
		{ key: leaf.publicKey, dsaEncoding: "ieee-p1363" },
		cose.signature,
	);
	if (!ok) throw new Error("signature: COSE_Sign1 signature invalid");
}
