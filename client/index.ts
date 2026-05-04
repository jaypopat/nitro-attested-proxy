import { parseArgs } from "node:util";
import { connect } from "bun";
import { verifyAttestation } from "./verify";

type Mode = ["echo", "attest"][number];

const { values } = parseArgs({
	args: Bun.argv.slice(2),
	options: {
		host: { type: "string" },
		port: { type: "string", default: "8000" },
		mode: { type: "string", default: "echo" },
		message: { type: "string", default: "hello from client\n" },
	},
});

if (!values.host) {
	console.error(
		"usage: bun run index.ts --host <ip> [--port <p>] [--mode echo|attest] [--message <text>]",
	);
	process.exit(1);
}

if (values.mode !== "echo" && values.mode !== "attest") {
	console.error(`unknown --mode: ${values.mode} (expected echo|attest)`);
	process.exit(1);
}

const port = parseInt(values.port, 10);
const mode: Mode = values.mode;
const message = values.message;
const nonce = crypto.getRandomValues(new Uint8Array(32));

console.log(`${mode} ${values.host}:${port}`);

const chunks: Uint8Array[] = [];
const { promise: closed, resolve, reject } = Promise.withResolvers<void>();

const timeout = setTimeout(() => reject(new Error("timeout 5s")), 5000);

await connect({
	hostname: values.host,
	port,
	socket: {
		open(socket) {
			if (mode === "echo") {
				socket.write(`ECHO\n${message}`);
			} else {
				socket.write(`ATTEST ${Buffer.from(nonce).toString("hex")}\n`);
			}
		},
		data(socket, data) {
			chunks.push(new Uint8Array(data));
			if (mode === "echo") socket.end();
		},
		close() {
			clearTimeout(timeout);
			resolve();
		},
		error(_socket, err) {
			clearTimeout(timeout);
			reject(err);
		},
	},
});

try {
	await closed;
} catch (err) {
	console.error("error:", (err as Error).message);
	process.exit(1);
}

const flat = Buffer.concat(chunks);

if (mode === "echo") {
	console.log(`recv ${flat.length}b: ${JSON.stringify(flat.toString("utf8"))}`);
} else {
	await Bun.write("attestation.cbor", flat);
	console.log(`recv ${flat.length}b → client/attestation.cbor`);
	try {
		const doc = verifyAttestation(new Uint8Array(flat), nonce);
		const pcr0 = doc.pcrs.get(0);
		const pcr0Hex = pcr0 ? Buffer.from(pcr0).toString("hex").slice(0, 16) : "?";
		console.log(`verified ${doc.module_id} pcr0=${pcr0Hex}…`);
	} catch (err) {
		console.error("verify failed:", (err as Error).message);
		process.exit(1);
	}
}
