set shell := ["bash", "-cu"]

ENCLAVE_CID := "16"
ENCLAVE_VSOCK_PORT := "5005"
HOST_TCP_PORT := "8000"

default:
    @just --list

# Provision the EC2 host and run user-data.
infra-up:
    cd infra && tofu init && tofu apply -auto-approve

# Destroy everything.
infra-down:
    cd infra && tofu destroy -auto-approve

# Sync source, build EIF, run enclave, start the TCP->vsock bridge.
deploy:
    just stop || true
    rsync -av --exclude target --delete \
      -e "ssh -i infra/ssh_key.pem -o StrictHostKeyChecking=accept-new" \
      ./enclave/ ec2-user@$(just _ip):~/enclave/
    just ssh 'cd ~/enclave && docker build -t enclave-app . && nitro-cli build-enclave --docker-uri enclave-app:latest --output-file enclave.eif'
    just ssh 'nitro-cli run-enclave \
      --cpu-count 2 \
      --memory 512 \
      --enclave-cid {{ ENCLAVE_CID }} \
      --eif-path ~/enclave/enclave.eif \
      --debug-mode'
    just ssh 'nohup socat TCP-LISTEN:{{ HOST_TCP_PORT }},fork,reuseaddr \
      VSOCK-CONNECT:{{ ENCLAVE_CID }}:{{ ENCLAVE_VSOCK_PORT }} \
      > /tmp/socat.log 2>&1 &'

# Stop the enclave and the proxy. Leaves infra up.
# Matching socat by process name (not -f) avoids the shell self-killing itself.
stop:
    just ssh 'nitro-cli terminate-enclave --all 2>/dev/null; pkill -x socat 2>/dev/null; true'

# SSH into the host. Pass a remote command, e.g. `just ssh 'docker ps'`.
# With no args, opens an interactive shell.
ssh *cmd:
    ssh -i infra/ssh_key.pem -o StrictHostKeyChecking=accept-new ec2-user@$(just _ip) {{ if cmd == "" { "" } else { quote(cmd) } }}

# Stream the enclave's stdout via nitro-cli console.
logs:
    just ssh 'nitro-cli console --enclave-id $(nitro-cli describe-enclaves | jq -r ".[0].EnclaveID")'

# Run the TS client against the live host.
client *args:
    cd client && bun run index.ts --host $(just _ip) --port {{ HOST_TCP_PORT }} {{ args }}

# Private: read the EC2 public IP from tofu state.
_ip:
    @cd infra && tofu output -raw instance_ip
