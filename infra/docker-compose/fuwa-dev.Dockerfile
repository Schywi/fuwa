FROM alpine:3.20

RUN apk add --no-cache \
    bash \
    coreutils \
    curl \
    findutils \
    inotify-tools \
    lua5.4 \
    socat

WORKDIR /workspace

ENV PORT=8080
ENV LUA_BIN=lua5.4
ENV FUWA_VECTOR_URL=http://vector-router:8687/

CMD ["./dev.sh"]
