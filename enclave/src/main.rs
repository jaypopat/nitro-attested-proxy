mod attest;
mod echo;
mod hex;

use std::io::{BufRead, BufReader, Write};

use vsock::{VMADDR_CID_ANY, VsockListener, VsockStream};

use attest::attest;
use echo::echo_loop;

const PORT: u32 = 5005;

fn main() -> std::io::Result<()> {
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

    let mut cmd_line = String::new();
    reader.read_line(&mut cmd_line)?;
    let cmd_line = cmd_line.trim_end_matches('\n');
    let (verb, rest) = cmd_line.split_once(' ').unwrap_or((cmd_line, ""));
    println!(
        "enclave: handling command verb={verb:?} rest_len={}",
        rest.len()
    );

    match verb {
        "ECHO" => echo_loop(&mut reader, &mut writer),
        "ATTEST" => match hex::decode_32(rest) {
            Ok(nonce) => attest(&mut writer, nonce),
            Err(e) => writer.write_all(format!("error: bad nonce: {e}\n").as_bytes()),
        },
        _ => writer.write_all(b"error: unknown command\n"),
    }
}
