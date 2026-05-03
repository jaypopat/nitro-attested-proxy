use std::io::{Read, Write};

pub fn echo_loop<R: Read, W: Write>(reader: &mut R, writer: &mut W) -> std::io::Result<()> {
    let mut buf = [0u8; 4096];
    loop {
        let n = reader.read(&mut buf)?;
        if n == 0 {
            println!("enclave: client disconnected");
            return Ok(());
        }
        writer.write_all(&buf[..n])?;
    }
}
