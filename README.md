# attested-proxy

Building a e2e project for **remote attestations** against AWS Nitro Enclaves.

### What this does

- A TypeScript client sends a sensitive payload (e.g. a credit card number) to a Rust service running inside a Nitro Enclave.
- Before sending anything, the client demands cryptographic proof of *what code* is running and *on what hardware*.
- The enclave produces a signed attestation document. The client verifies the chain back to the AWS Nitro root, pins the code measurement (PCR0), and extracts a public key bound to that proof.
- The client encrypts the payload to that key. The enclave decrypts inside isolated memory, processes the payload, returns an encrypted response.
- The EC2 host — and anyone with `root` on it — sees only ciphertext throughout.


### Security Model

- The host operator, including `root` on the parent EC2 instance, cannot read payloads, responses, or the enclave's private key.
- The host cannot swap the enclave's keypair or substitute different code without breaking the COSE signature chain.
- The client refuses to encrypt to anything that does not verify back to the AWS Nitro root certificate.

### How this works

1. Enclave generates an X25519 keypair on startup. The private key never leaves enclave memory.
2. Enclave asks `/dev/nsm` for a `COSE_Sign1` attestation document binding `(PCR0, public_key, hardware identity)`. The NSM signs with a per-instance key chained to the AWS Nitro root.
3. Client walks the certificate chain to the pinned root, checks PCR0, and extracts the public key **from the signed document** — not from a separate field. That distinction is load-bearing.
4. Client encrypts the payload to the attested key.
5. Enclave decrypts, processes, encrypts the response, returns it.

Any failure — expired cert, wrong signer, mismatched PCR, debug-mode enclave — and the client refuses to send.


### Project Structure

- **`enclave/`** — Rust. Keygen, NSM attestation, vsock listener, decrypt / process / encrypt.
- **`client/`** — TypeScript CLI. Fetch attestation, verify COSE chain, pin PCR0, encrypt, decrypt response.
- **`infra/`** — OpenTofu. Enclave-enabled EC2, security group, generated SSH key, user-data installing `nitro-cli`, Docker, and `socat`.

### Quickstart

Prerequisites: AWS credentials, [OpenTofu](https://opentofu.org/), [just](https://github.com/casey/just), [Bun](https://bun.sh/).

```sh
just infra-up      # provision enclave-enabled EC2
just up            # sync source, build EIF, run enclave, start proxy
just client        # run the handshake and send a payload
just infra-down    # tear down
```

All workflows run through `just` — run with no arguments to list every recipe.
