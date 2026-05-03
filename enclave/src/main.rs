use std::io::{Read, Write};
use vsock::{VMADDR_CID_ANY, VsockListener};

const PORT: u32 = 5005;

fn main() -> std::io::Result<()> {
    let listener = VsockListener::bind_with_cid_port(VMADDR_CID_ANY, PORT)?;
    println!("enclave: listening on vsock cid=ANY port={PORT}");

    for stream in listener.incoming() {
        let mut stream = stream?;
        println!("enclave: connection accepted");

        let mut buf = [0u8; 4096];
        loop {
            let n = stream.read(&mut buf)?;
            if n == 0 {
                println!("enclave: peer closed");
                break;
            }
            stream.write_all(&buf[..n])?;
        }
    }

    Ok(())
}
