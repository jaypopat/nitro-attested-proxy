import { describe, expect, test } from "bun:test";
import {
	Aes256Gcm,
	CipherSuite,
	DhkemX25519HkdfSha256,
	HkdfSha256,
} from "@hpke/core";
import { HPKE_INFO, RESP_KEY_LABEL, RESP_NONCE_LABEL, sealRequest } from ".";

const suite = new CipherSuite({
	kem: new DhkemX25519HkdfSha256(),
	kdf: new HkdfSha256(),
	aead: new Aes256Gcm(),
});

const enc = new TextEncoder();

async function newRecipientKeypair() {
	const kp = await suite.kem.generateKeyPair();
	const pkRaw = new Uint8Array(
		await suite.kem.serializePublicKey(kp.publicKey),
	);
	return { kp, pkRaw };
}

async function fakeEnclave(
	recipientPrivateKey: CryptoKey,
	encFromClient: Uint8Array<ArrayBuffer>,
	requestCt: Uint8Array<ArrayBuffer>,
	process: (pt: Uint8Array) => Uint8Array<ArrayBuffer>,
): Promise<Uint8Array<ArrayBuffer>> {
	const recipient = await suite.createRecipientContext({
		recipientKey: recipientPrivateKey,
		enc: encFromClient,
		info: HPKE_INFO,
	});
	const pt = new Uint8Array(await recipient.open(requestCt));
	const respPt = process(pt);

	const respKey = new Uint8Array(await recipient.export(RESP_KEY_LABEL, 32));
	const respNonce = new Uint8Array(
		await recipient.export(RESP_NONCE_LABEL, 12),
	);
	const aesKey = await crypto.subtle.importKey(
		"raw",
		respKey,
		{ name: "AES-GCM" },
		false,
		["encrypt"],
	);
	const respCt = new Uint8Array(
		await crypto.subtle.encrypt(
			{ name: "AES-GCM", iv: respNonce },
			aesKey,
			respPt,
		),
	);
	return respCt;
}

describe("client/crypto HPKE round-trip", () => {
	test("seal request → fake enclave decrypts/uppercases/seals → openResponse decrypts", async () => {
		const { kp, pkRaw } = await newRecipientKeypair();
		const sealed = await sealRequest(pkRaw, enc.encode("hello world"));

		const respCt = await fakeEnclave(
			kp.privateKey,
			sealed.enc,
			sealed.ciphertext,
			(pt) =>
				new Uint8Array(
					new TextEncoder().encode(new TextDecoder().decode(pt).toUpperCase()),
				),
		);

		const opened = await sealed.openResponse(respCt);
		expect(new TextDecoder().decode(opened)).toBe("HELLO WORLD");
	});

	test("rejects request ciphertext with flipped tag bit (AEAD authenticity)", async () => {
		const { kp, pkRaw } = await newRecipientKeypair();
		const sealed = await sealRequest(pkRaw, enc.encode("payload"));
		const tampered: Uint8Array<ArrayBuffer> = new Uint8Array(sealed.ciphertext);
		const last = tampered.at(-1);
		if (last === undefined) throw new Error("ciphertext unexpectedly empty");
		tampered[tampered.length - 1] = last ^ 0x01;
		await expect(
			fakeEnclave(
				kp.privateKey,
				sealed.enc,
				tampered,
				(pt) => new Uint8Array(pt),
			),
		).rejects.toThrow();
	});

	test("rejects request under wrong recipient private key", async () => {
		const a = await newRecipientKeypair();
		const b = await newRecipientKeypair();
		const sealed = await sealRequest(a.pkRaw, enc.encode("payload"));
		await expect(
			fakeEnclave(
				b.kp.privateKey,
				sealed.enc,
				sealed.ciphertext,
				(pt) => new Uint8Array(pt),
			),
		).rejects.toThrow();
	});

	test("rejects recipient pubkey of wrong length", async () => {
		await expect(
			sealRequest(new Uint8Array(31), enc.encode("x")),
		).rejects.toThrow(/expected 32 bytes/);
	});

	test("openResponse rejects tampered response ciphertext", async () => {
		const { kp, pkRaw } = await newRecipientKeypair();
		const sealed = await sealRequest(pkRaw, enc.encode("hello"));
		const respCt = await fakeEnclave(
			kp.privateKey,
			sealed.enc,
			sealed.ciphertext,
			(pt) => new Uint8Array(pt),
		);
		const tampered: Uint8Array<ArrayBuffer> = new Uint8Array(respCt);
		const last = tampered.at(-1);
		if (last === undefined) throw new Error("response unexpectedly empty");
		tampered[tampered.length - 1] = last ^ 0x01;
		await expect(sealed.openResponse(tampered)).rejects.toThrow();
	});
});
