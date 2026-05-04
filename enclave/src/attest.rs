use std::io::Write;

use aws_nitro_enclaves_nsm_api::api::{Request, Response};
use aws_nitro_enclaves_nsm_api::driver::{nsm_exit, nsm_init, nsm_process_request};
use serde_bytes::ByteBuf;

pub fn attest<W: Write>(writer: &mut W, nonce: Vec<u8>) -> std::io::Result<()> {
    let fd = nsm_init();
    if fd < 0 {
        eprintln!("enclave: failed to open /dev/nsm (fd={fd})");
        writer.write_all(b"error: nsm_init failed\n")?;
        return Ok(());
    }

    let request = Request::Attestation {
        user_data: None,
        nonce: Some(ByteBuf::from(nonce)),
        public_key: None,
    };
    let response = nsm_process_request(fd, request);
    nsm_exit(fd);

    match response {
        Response::Attestation { document } => {
            println!(
                "enclave: signed attestation document ready ({} bytes)",
                document.len()
            );
            writer.write_all(&document)?;
        }
        other => {
            eprintln!("enclave: unexpected NSM response: {other:?}");
            writer.write_all(b"error: unexpected NSM response\n")?;
        }
    }

    Ok(())
}
