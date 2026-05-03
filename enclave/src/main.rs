mod attest;
mod echo;

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

    // reader and a writer to the vsock socket - we clone it
    let mut writer = stream.try_clone()?;
    let mut reader = BufReader::new(stream);

    let mut cmd = String::new();
    reader.read_line(&mut cmd)?;
    let cmd = cmd.trim_end_matches('\n'); // this is echo or attest currently
    println!("enclave: handling command {cmd:?}");

    match cmd {
        "ECHO" => echo_loop(&mut reader, &mut writer),
        "ATTEST" => attest(&mut writer),
        _ => writer.write_all(b"error: unknown command\n"),
    }
}
