set shell := ["bash", "-cu"]

ENCLAVE_CID := "16"
ENCLAVE_VSOCK_PORT := "5005"
HOST_TCP_PORT := "8000"
UPSTREAM_HOST := "httpbin.org"
UPSTREAM_PORT := "443"
PROXY_VSOCK_PORT := "8001"

default:
    @just --list

# Provision the EC2 host and run user-data.
infra-up:
    cd infra && tofu init && tofu apply -auto-approve

# Destroy everything.
infra-down:
    cd infra && tofu destroy -auto-approve

# Sync source, build EIF, run enclave, start the TCP->vsock bridge.
# Prints the new EIF's PCR0 but does NOT overwrite client/verify/pinned-pcrs.json.

# Run `just pin-pcrs` separately after reviewing the printed measurements.
deploy:
    just stop || true
    rsync -av --exclude target --delete \
      -e "ssh -i infra/ssh_key.pem -o StrictHostKeyChecking=accept-new" \
      ./enclave/ ec2-user@$(just _ip):~/enclave/
    just ssh 'cd ~/enclave && docker build -t enclave-app . && nitro-cli build-enclave --docker-uri enclave-app:latest --output-file enclave.eif'
    @echo ""
    @echo "==> Built EIF measurements:"
    just ssh 'nitro-cli describe-eif --eif-path ~/enclave/enclave.eif | jq .Measurements'
    @echo ""
    @echo "==> Review PCR0 above. To pin it for the client, run: just pin-pcrs"
    @echo "    (deploy no longer auto-overwrites client/verify/pinned-pcrs.json)"
    just ssh 'nitro-cli run-enclave \
      --cpu-count 2 \
      --memory 512 \
      --enclave-cid {{ ENCLAVE_CID }} \
      --eif-path ~/enclave/enclave.eif'
    just ssh 'nohup socat TCP-LISTEN:{{ HOST_TCP_PORT }},fork,reuseaddr \
      VSOCK-CONNECT:{{ ENCLAVE_CID }}:{{ ENCLAVE_VSOCK_PORT }} \
      </dev/null >/tmp/socat.log 2>&1 &'
    just ssh 'printf "allowlist:\n- {address: {{ UPSTREAM_HOST }}, port: {{ UPSTREAM_PORT }}}\n" > /tmp/vsock-proxy.yaml && \
      nohup vsock-proxy --config /tmp/vsock-proxy.yaml \
      {{ PROXY_VSOCK_PORT }} {{ UPSTREAM_HOST }} {{ UPSTREAM_PORT }} \
      </dev/null >/tmp/vsock-proxy.log 2>&1 &'

# Pin the currently-deployed EIF's PCR0 into client/verify/pinned-pcrs.json.

# Run this after reviewing the measurements printed by `just deploy`.
pin-pcrs:
    just ssh 'nitro-cli describe-eif --eif-path ~/enclave/enclave.eif | jq -e .Measurements' > client/verify/pinned-pcrs.json
    @echo ""
    @echo "==> Updated client/verify/pinned-pcrs.json — commit it alongside the enclave change."

# Stop the enclave and the proxy. Leaves infra up.

# Matching socat by process name (not -f) avoids the shell self-killing itself.
stop:
    just ssh 'nitro-cli terminate-enclave --all 2>/dev/null; pkill -x socat 2>/dev/null; pkill -x vsock-proxy 2>/dev/null; true'

# SSH into the host. Pass a remote command, e.g. `just ssh 'docker ps'`.

# With no args, opens an interactive shell.
ssh *cmd:
    ssh -i infra/ssh_key.pem -o StrictHostKeyChecking=accept-new ec2-user@$(just _ip) {{ if cmd == "" { "" } else { quote(cmd) } }}

# Stream the enclave's stdout via nitro-cli console.
# Only works when the enclave was started with --debug-mode. Production
# deploys (no --debug-mode) reject console attaches with E44; in that case
# temporarily re-add --debug-mode to the run-enclave invocation, redeploy,

# capture logs, then strip the flag again.
logs:
    just ssh 'nitro-cli console --enclave-id $(nitro-cli describe-enclaves | jq -r ".[0].EnclaveID")'

# Run the TS client against the live host.
client *args:
    cd client && bun run index.ts --host $(just _ip) --port {{ HOST_TCP_PORT }} {{ args }}

# Run the SDK usage example (loops a few sends through AttestedClient).
example:
    cd client && bun run sdk/example.ts $(just _ip)

# Format both sides.
fmt:
    cd enclave && cargo fmt
    cd client && bun run lint:fix

# Lint both sides — fmt check + clippy + biome + tsc. Fails on warnings.
lint:
    cd enclave && cargo fmt --check
    cd enclave && cargo clippy --all-targets -- -D warnings
    cd client && bun run lint
    cd client && bunx tsc --noEmit

# Run tests on both sides.
test:
    cd enclave && cargo test
    cd client && bun test

# Private: read the EC2 public IP from tofu state.
_ip:
    @cd infra && tofu output -raw instance_ip
