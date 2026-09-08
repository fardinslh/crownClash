# Build the Go runtime module. The toolchain version MUST match the one the
# nakama binary was built with (go1.26.5 for nakama 3.40.0) or plugin loading
# fails; the base image must be glibc-based (bookworm) to match the nakama
# runtime image.
FROM golang:1.26.5 AS builder

WORKDIR /src
COPY apps/server-nakama/go.mod ./
RUN go mod download
COPY apps/server-nakama ./
RUN go build -trimpath -buildmode=plugin -o /build/crownclash.so .

FROM heroiclabs/nakama:3.40.0

COPY --from=builder /build/crownclash.so /nakama/data/modules/
