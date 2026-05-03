#!/bin/bash
set -euxo pipefail

# Nitro Enclaves CLI, Docker, and socat (for TCP -> vsock bridging).
dnf install -y \
  aws-nitro-enclaves-cli \
  aws-nitro-enclaves-cli-devel \
  docker \
  socat \
  jq \
  git

# Allocator: 2 vCPUs and 512 MiB for the enclave.
cat > /etc/nitro_enclaves/allocator.yaml <<'EOF'
---
memory_mib: 512
cpu_count: 2
EOF

systemctl enable --now nitro-enclaves-allocator.service
systemctl enable --now docker

# So ec2-user can run nitro-cli and docker without sudo.
usermod -aG ne ec2-user
usermod -aG docker ec2-user
