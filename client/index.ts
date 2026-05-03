import { connect } from "bun";
import { parseArgs } from "util";

const { values } = parseArgs({
  args: Bun.argv.slice(2),
  options: {
    host: { type: "string" },
    port: { type: "string", default: "8000" },
    message: { type: "string", default: "hello from client\n" },
  },
});

if (!values.host) {
  console.error("usage: bun run index.ts --host <ip> [--port <port>] [--message <text>]");
  process.exit(1);
}

const port = Number.parseInt(values.port!, 10);
const message = values.message!;

console.log(`connecting to ${values.host}:${port}`);

const timeout = setTimeout(() => {
  console.error("timeout: no response within 5s");
  process.exit(1);
}, 5000);

await connect({
  hostname: values.host,
  port,
  socket: {
    open(socket) {
      console.log(`connected; sending ${JSON.stringify(message)}`);
      socket.write(message);
    },
    data(socket, data) {
      const text = new TextDecoder().decode(data);
      console.log(`recv (${data.length} bytes): ${JSON.stringify(text)}`);
      socket.end();
    },
    close() {
      clearTimeout(timeout);
      console.log("connection closed");
      process.exit(0);
    },
    error(_socket, err) {
      clearTimeout(timeout);
      console.error("socket error:", err.message);
      process.exit(1);
    },
  },
});
