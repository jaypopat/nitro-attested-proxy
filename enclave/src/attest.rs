use std::io::Write;

use aws_nitro_enclaves_nsm_api::api::{Request, Response};
use aws_nitro_enclaves_nsm_api::driver::nsm_process_request;
use serde_bytes::ByteBuf;

use crate::wire::{codes, write_err, write_ok};
use crate::{keys, nsm, wire};

pub fn handle_attest<W: Write>(writer: &mut W, nonce_b64: &str) -> std::io::Result<()> {
    let nonce_bytes = match wire::decode_b64(nonce_b64) {
        Ok(b) => b,
        Err(e) => return write_err(writer, codes::BAD_NONCE, &format!("decode: {e}")),
    };
    if nonce_bytes.len() != 32 {
        return write_err(
            writer,
            codes::BAD_NONCE,
            &format!("expected 32 bytes, got {}", nonce_bytes.len()),
        );
    }

    let request = Request::Attestation {
        user_data: None,
        nonce: Some(ByteBuf::from(nonce_bytes)),
        public_key: Some(ByteBuf::from(keys::public_key_bytes().to_vec())),
    };

    match nsm_process_request(nsm::fd(), request) {
        Response::Attestation { document } => {
            println!(
                "enclave: signed attestation document ready ({} bytes)",
                document.len()
            );
            write_ok(writer, &document)
        }
        other => {
            eprintln!("enclave: unexpected NSM response: {other:?}");
            write_err(writer, codes::NSM_ERROR, &format!("{other:?}"))
        }
    }
}
