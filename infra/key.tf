# Every time we spin up infra, we generate a fresh ed25519 key pair - used by the justfile

resource "tls_private_key" "this" {
  algorithm = "ED25519"
}

resource "aws_key_pair" "this" {
  key_name   = "${var.name}-key"
  public_key = tls_private_key.this.public_key_openssh
}

resource "local_sensitive_file" "private_key" {
  content         = tls_private_key.this.private_key_openssh
  filename        = "${path.module}/ssh_key.pem"
  file_permission = "0600"
}
