mod attest;
mod keys;
mod nsm;
mod send;
mod upstream;
mod wire;

use std::io::{BufRead, BufReader};

use vsock::{VMADDR_CID_ANY, VsockListener, VsockStream};

const PORT: u32 = 5005;

fn main() -> std::io::Result<()> {
    nsm::init();
    keys::init();
    upstream::install_crypto_provider();
    println!(
        "enclave: x25519 pubkey {}",
        hex::encode(keys::public_key_bytes())
    );

    let listener = VsockListener::bind_with_cid_port(VMADDR_CID_ANY, PORT)?;
    println!("enclave: ready, listening on vsock port {PORT}");

    for stream in listener.incoming() {
        match stream {
            Ok(s) => {
                if let Err(e) = handle(s) {
                    eprintln!("enclave: handler bailed: {e}");
                }
            }
            Err(e) => eprintln!("enclave: failed to accept connection: {e}"),
        }
    }

    Ok(())
}

fn handle(stream: VsockStream) -> std::io::Result<()> {
    println!("enclave: client connected");

    let mut writer = stream.try_clone()?;
    let mut reader = BufReader::new(stream);

    let mut line = String::new();
    reader.read_line(&mut line)?;

    let req: wire::Request = match serde_json::from_str(line.trim_end_matches('\n')) {
        Ok(r) => r,
        Err(e) => {
            return wire::write_err(
                &mut writer,
                wire::codes::INVALID_REQUEST,
                &format!("invalid request: {e}"),
            );
        }
    };

    match req {
        wire::Request::Attest { nonce } => {
            println!("enclave: handling mode=attest");
            attest::handle_attest(&mut writer, &nonce)
        }
        wire::Request::Send { enc, ct } => {
            println!("enclave: handling mode=send");
            send::handle_send(&mut writer, &enc, &ct)
        }
    }
}
