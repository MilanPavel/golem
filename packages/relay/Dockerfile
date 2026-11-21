# The golem relay in one small container (ADR-051, "Self-hosting").
# The build context is packages/relay:
#   docker build -t golem-relay packages/relay
# From the repository root, that is the same as the line above.

FROM oven/bun:1-alpine AS build
WORKDIR /app
COPY src ./src
RUN bun build --compile --minify src/bun/main.ts --outfile relay

FROM oven/bun:1-alpine
# The base image has a non-root `bun` user.
USER bun
WORKDIR /home/bun
COPY --from=build /app/relay /usr/local/bin/golem-relay
ENV BIND=0.0.0.0:8080
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s --start-period=3s \
  CMD wget -q -O /dev/null http://127.0.0.1:8080/healthz || exit 1
ENTRYPOINT ["golem-relay"]
