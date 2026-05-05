import { parseArgs } from "node:util";
import { AttestedClient } from "./sdk";

const { values } = parseArgs({
	args: Bun.argv.slice(2),
	options: {
		host: { type: "string" },
		port: { type: "string" },
		message: { type: "string" },
	},
});

const { host, message } = values;

if (!host) {
	console.error(
		"usage: bun run index.ts --host <ip> [--port <p>] [--message <text>]",
	);
	process.exit(1);
}

try {
	const session = await AttestedClient.open({ host });
	console.log(`verified ${session.doc.module_id} pcr0=${session.pcr0Hex}`);
	if (message !== undefined) {
		const response = await session.send(message);
		console.log(
			`decrypted: ${JSON.stringify(new TextDecoder().decode(response))}`,
		);
	}
} catch (err) {
	console.error("error:", (err as Error).message);
	process.exit(1);
}
