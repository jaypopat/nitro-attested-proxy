import { connect } from "bun";
import { parseArgs } from "util";

type Mode = "echo" | "attest";

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

const port = Number.parseInt(values.port!, 10);
const mode: Mode = values.mode;
const message = values.message!;

console.log(`connecting to ${values.host}:${port} in ${mode} mode...`);

const chunks: Uint8Array[] = [];
const { promise: closed, resolve, reject } = Promise.withResolvers<void>();

const timeout = setTimeout(
	() => reject(new Error("timeout: no response within 5s")),
	5000,
);

await connect({
	hostname: values.host,
	port,
	socket: {
		open(socket) {
			socket.write(mode === "echo" ? `ECHO\n${message}` : "ATTEST\n");
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
	console.log(
		`received ${flat.length} bytes: ${JSON.stringify(flat.toString("utf8"))}`,
	);
} else {
	await Bun.write("attestation.cbor", flat);
	console.log(
		`received ${flat.length}-byte attestation document, saved to client/attestation.cbor`,
	);
}
