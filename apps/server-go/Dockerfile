FROM golang:1.23-alpine AS build

WORKDIR /src
COPY apps/server-go/go.mod ./apps/server-go/
RUN cd apps/server-go && go mod download
COPY apps/server-go ./apps/server-go
RUN cd apps/server-go && CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /out/crown-clash-server .

FROM gcr.io/distroless/static-debian12:nonroot
COPY --from=build /out/crown-clash-server /crown-clash-server
USER nonroot:nonroot
EXPOSE 8787
HEALTHCHECK --interval=10s --timeout=3s --start-period=10s --retries=3 CMD ["/crown-clash-server", "healthcheck"]
ENTRYPOINT ["/crown-clash-server"]
