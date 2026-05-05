import { describe, expect, test } from "bun:test";
import { verifyAttestation } from ".";

const FIXTURE = await Bun.file(`${import.meta.dir}/fixture.cbor`).bytes();

const allSkip = {
	skipNonce: true,
	skipPcr0: true,
	skipTimestamp: true,
};

describe("verifyAttestation against committed debug-mode fixture", () => {
	test("happy path: parses, walks chain, verifies signature", () => {
		const doc = verifyAttestation(FIXTURE, undefined, allSkip);
		expect(doc.module_id).toMatch(/^i-[0-9a-f]+-enc[0-9a-f]+$/);
		expect(doc.digest).toBe("SHA384");
		expect(doc.pcrs.size).toBeGreaterThanOrEqual(3);
		expect(doc.cabundle.length).toBeGreaterThan(0);
	});

	test("rejects when nonce required but doc has none", () => {
		const expectedNonce = new Uint8Array(32);
		expect(() =>
			verifyAttestation(FIXTURE, expectedNonce, {
				...allSkip,
				skipNonce: false,
			}),
		).toThrow(/^nonce: doc\.nonce missing/);
	});

	test("rejects when nonce expected but caller provides none", () => {
		expect(() =>
			verifyAttestation(FIXTURE, undefined, { ...allSkip, skipNonce: false }),
		).toThrow(/^nonce: no expected nonce provided/);
	});

	test("rejects PCR0 mismatch", () => {
		const wrongPcr0 = new Uint8Array(48).fill(0xab);
		expect(() =>
			verifyAttestation(FIXTURE, undefined, {
				...allSkip,
				skipPcr0: false,
				pinnedPcr0: wrongPcr0,
			}),
		).toThrow(/^pcr0: value mismatch/);
	});

	test("rejects tampered signature bytes", () => {
		const tampered = new Uint8Array(FIXTURE);
		const i = tampered.length - 10;
		const original = tampered[i] ?? 0;
		tampered[i] = original ^ 0x01;
		expect(() => verifyAttestation(tampered, undefined, allSkip)).toThrow(
			/^signature:/,
		);
	});

	test("rejects truncated cbor (parse failure)", () => {
		const truncated = FIXTURE.slice(0, 10);
		expect(() => verifyAttestation(truncated, undefined, allSkip)).toThrow(
			/^parse:/,
		);
	});

	test("rejects stale timestamp when not skipped", () => {
		expect(() =>
			verifyAttestation(FIXTURE, undefined, {
				...allSkip,
				skipTimestamp: false,
			}),
		).toThrow(/^timestamp:/);
	});
});
