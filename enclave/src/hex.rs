pub fn decode_32(s: &str) -> Result<Vec<u8>, &'static str> {
    if s.len() != 64 {
        return Err("expected 64 hex chars (32 bytes)");
    }
    let bytes = s.as_bytes();
    let mut out = Vec::with_capacity(32);
    for i in 0..32 {
        let hi = nibble(bytes[i * 2])?;
        let lo = nibble(bytes[i * 2 + 1])?;
        out.push((hi << 4) | lo);
    }
    Ok(out)
}

fn nibble(c: u8) -> Result<u8, &'static str> {
    match c {
        b'0'..=b'9' => Ok(c - b'0'),
        b'a'..=b'f' => Ok(c - b'a' + 10),
        b'A'..=b'F' => Ok(c - b'A' + 10),
        _ => Err("invalid hex digit"),
    }
}
