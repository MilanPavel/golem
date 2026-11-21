# The golem relay in one small container (ADR-051, "Self-hosting").
# The build context is the repository root, because the relay imports one file of the gateway:
#   docker build -f packages/relay/Dockerfile -t golem-relay .

FROM oven/bun:1-alpine AS build
WORKDIR /app
COPY packages/gateway/src/secret.ts ./packages/gateway/src/secret.ts
COPY packages/relay/src ./packages/relay/src
WORKDIR /app/packages/relay
RUN bun build --compile --minify src/bun/main.ts --outfile relay

FROM oven/bun:1-alpine
# The base image has a non-root `bun` user.
USER bun
WORKDIR /home/bun
COPY --from=build /app/packages/relay/relay /usr/local/bin/golem-relay
ENV BIND=0.0.0.0:8080
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s --start-period=3s \
  CMD wget -q -O /dev/null http://127.0.0.1:8080/healthz || exit 1
ENTRYPOINT ["golem-relay"]
