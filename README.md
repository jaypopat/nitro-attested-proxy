# attested-proxy

A minimal demo of **remote attestation** against AWS Nitro Enclaves.

## What this does

- A TypeScript client sends a sensitive payload (e.g. a credit card number) to a Rust service running inside a Nitro Enclave.
- Before sending anything, the client demands cryptographic proof of *what code* is running and *on what hardware*.
- The enclave produces a signed attestation document. The client verifies the chain back to the AWS Nitro root, pins the code measurement (PCR0), and extracts a public key bound to that proof.
- The client encrypts the payload to that key. The enclave decrypts inside isolated memory, processes the payload, returns an encrypted response.
- The EC2 host — and anyone with `root` on it — sees only ciphertext throughout.
