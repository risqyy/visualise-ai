# syntax=docker/dockerfile:1

# ---- build ----------------------------------------------------------------
FROM golang:1.25-alpine AS build

WORKDIR /src

# Dependencies are cached separately from the sources.
COPY go.mod go.sum ./
RUN go mod download

COPY . .

ARG VERSION=dev
RUN CGO_ENABLED=0 GOOS=linux go build \
    -trimpath \
    -ldflags "-s -w -X main.version=${VERSION}" \
    -o /out/server ./cmd/server

# ---- runtime --------------------------------------------------------------
FROM alpine:3.21 AS runtime

# wget (busybox) backs the container healthcheck; ca-certificates keeps
# outbound TLS usable.
RUN apk add --no-cache ca-certificates \
    && adduser -D -u 10001 app

COPY --from=build /out/server /usr/local/bin/server

USER app
WORKDIR /home/app

# Documentation only: the port stays inside the Compose network.
EXPOSE 8080

ENTRYPOINT ["/usr/local/bin/server"]
