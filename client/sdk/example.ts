import { AttestedClient } from ".";

const [host] = Bun.argv.slice(2); // ec2 ip
if (!host) {
	console.error("usage: bun run sdk/example.ts <host>");
	process.exit(1);
}

const enclave = await AttestedClient.open({ host });
console.log(`verified ${enclave.doc.module_id} pcr0=${enclave.pcr0Hex}`);
for (const message of ["alpha", "beta", "gamma"]) {
	const response = await enclave.send(message);
	console.log(`${message} → ${new TextDecoder().decode(response)}`);
}
