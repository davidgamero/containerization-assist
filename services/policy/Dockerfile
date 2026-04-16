# syntax=docker/dockerfile:1.6

FROM golang:1.22-alpine AS builder
WORKDIR /src
COPY go.mod ./
COPY . .
RUN go mod tidy
# Static binary: nonroot distroless has no libc shims, so we fully disable cgo.
RUN CGO_ENABLED=0 GOOS=linux go build -trimpath -ldflags="-s -w" -o /out/policy ./

FROM gcr.io/distroless/static:nonroot
COPY --from=builder /out/policy /policy
EXPOSE 7070
USER nonroot:nonroot
ENTRYPOINT ["/policy"]
