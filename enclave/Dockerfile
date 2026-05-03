FROM rust:1-bookworm AS builder
WORKDIR /build
COPY Cargo.toml Cargo.lock ./
COPY src ./src
RUN cargo build --release

FROM debian:bookworm-slim
COPY --from=builder /build/target/release/enclave /usr/local/bin/enclave
CMD ["/usr/local/bin/enclave"]
