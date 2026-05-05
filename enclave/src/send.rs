use std::io::Write;

use aes_gcm::aead::Aead;
use aes_gcm::{Aes256Gcm, KeyInit, Nonce};

use crate::wire::{codes, write_err, write_ok};
use crate::{keys, upstream, wire};

// Labels must match client/crypto/index.ts. The response key + nonce are derived from the same HPKE context as the request — neither is sent on the wire.
const HPKE_INFO: &[u8] = b"attested-proxy/v1";
const RESP_KEY_LABEL: &[u8] = b"attested-proxy/v1 response key";
const RESP_NONCE_LABEL: &[u8] = b"attested-proxy/v1 response nonce";
const UPSTREAM_HOST: &str = "httpbin.org";

pub fn handle_send<W: Write>(writer: &mut W, enc_b64: &str, ct_b64: &str) -> std::io::Result<()> {
    let enc_bytes = match wire::decode_b64(enc_b64) {
        Ok(b) => b,
        Err(e) => return write_err(writer, codes::BAD_ENC, &format!("decode: {e}")),
    };
    let enc: [u8; 32] = match enc_bytes.as_slice().try_into() {
        Ok(arr) => arr,
        Err(_) => {
            return write_err(
                writer,
                codes::BAD_ENC,
                &format!("expected 32 bytes, got {}", enc_bytes.len()),
            );
        }
    };
    let ciphertext = match wire::decode_b64(ct_b64) {
        Ok(b) => b,
        Err(e) => return write_err(writer, codes::BAD_CIPHERTEXT, &format!("decode: {e}")),
    };

    let opened = match keys::open_and_export_response(
        &enc,
        &ciphertext,
        HPKE_INFO,
        RESP_KEY_LABEL,
        RESP_NONCE_LABEL,
    ) {
        Ok(o) => o,
        Err(e) => return write_err(writer, codes::HPKE_OPEN_FAILED, &format!("{e}")),
    };

    println!("enclave: SEND decrypted {} bytes", opened.plaintext.len());

    // SNI is compile-time so a malicious host can't redirect the TLS session
    let response_plaintext = match upstream::post(UPSTREAM_HOST, "/post", &opened.plaintext) {
        Ok(b) => b,
        Err(e) => return write_err(writer, codes::UPSTREAM_FAILED, &format!("{e}")),
    };

    let cipher = Aes256Gcm::new(&opened.response_key.into());
    let resp_ct = cipher
        .encrypt(
            Nonce::from_slice(&opened.response_nonce),
            response_plaintext.as_ref(),
        )
        .expect("AES-GCM encrypt is infallible for in-memory inputs");

    write_ok(writer, &resp_ct)
}
