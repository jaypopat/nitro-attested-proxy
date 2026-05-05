// HPKE suite matches enclave/src/keys.rs.

import {
	Aes256Gcm,
	CipherSuite,
	DhkemX25519HkdfSha256,
	HkdfSha256,
} from "@hpke/core";

const suite = new CipherSuite({
	kem: new DhkemX25519HkdfSha256(),
	kdf: new HkdfSha256(),
	aead: new Aes256Gcm(),
});

const enc = new TextEncoder();
// matches the enclave/src/send.rs.
export const HPKE_INFO = enc.encode("attested-proxy/v1");
export const RESP_KEY_LABEL = enc.encode("attested-proxy/v1 response key");
export const RESP_NONCE_LABEL = enc.encode("attested-proxy/v1 response nonce");

export type SealedRequest = {
	enc: Uint8Array<ArrayBuffer>;
	ciphertext: Uint8Array<ArrayBuffer>;
	openResponse: (
		responseCiphertext: Uint8Array<ArrayBuffer>,
	) => Promise<Uint8Array<ArrayBuffer>>;
};

// openResponse closes over the sender ctx so the response key + nonce can be
// derived from the same HPKE context that produced the request.
export async function sealRequest(
	recipientPubKeyRaw: Uint8Array<ArrayBuffer>,
	plaintext: Uint8Array<ArrayBuffer>,
): Promise<SealedRequest> {
	if (recipientPubKeyRaw.length !== 32) {
		throw new Error(
			`recipient pubkey: expected 32 bytes, got ${recipientPubKeyRaw.length}`,
		);
	}
	const recipientKey = await suite.kem.importKey(
		"raw",
		recipientPubKeyRaw,
		true,
	);
	const sender = await suite.createSenderContext({
		recipientPublicKey: recipientKey,
		info: HPKE_INFO,
	});
	const ciphertext = new Uint8Array(await sender.seal(plaintext));
	const encBytes = new Uint8Array(sender.enc);

	return {
		enc: encBytes,
		ciphertext,
		openResponse: async (responseCiphertext) => {
			const respKey = new Uint8Array(await sender.export(RESP_KEY_LABEL, 32));
			const respNonce = new Uint8Array(
				await sender.export(RESP_NONCE_LABEL, 12),
			);
			const aesKey = await crypto.subtle.importKey(
				"raw",
				respKey,
				{ name: "AES-GCM" },
				false,
				["decrypt"],
			);
			const pt = await crypto.subtle.decrypt(
				{ name: "AES-GCM", iv: respNonce },
				aesKey,
				responseCiphertext,
			);
			return new Uint8Array(pt);
		},
	};
}
