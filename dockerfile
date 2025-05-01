# Dockerfile
FROM ivangabriele/tauri:debian-bookworm-20

ENV BUN_INSTALL=/root/.bun
RUN curl -fsSL https://bun.sh/install | bash && \
    ln -s $BUN_INSTALL/bin/bun* /usr/local/bin/