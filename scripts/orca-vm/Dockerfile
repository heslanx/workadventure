# Base image for Orca per-workspace environments of WorkAdventure.
# Built by docker-base-image.sh; never run the Orca runtime or an agent login here.
FROM node:24-trixie-slim

ARG REPO_URL
ARG UPSTREAM_URL
ARG REPO_REF=master
ARG PROJECT_ROOT=/home/node/workadventure

ENV DEBIAN_FRONTEND=noninteractive

# Toolchain: git + gh for Git access, build tools for native npm modules, sshd for Orca's SSH relay.
RUN apt-get update \
    && apt-get install --yes --no-install-recommends \
        ca-certificates \
        curl \
        g++ \
        gh \
        git \
        make \
        openssh-server \
        procps \
        python3 \
        tini \
    && rm -rf /var/lib/apt/lists/* \
    && npm install --global @anthropic-ai/claude-code @openai/codex \
    && npm cache clean --force \
    && claude --version \
    && codex --version \
    # Host keys are generated per container by the entrypoint; never ship one in the image.
    && rm -f /etc/ssh/ssh_host_* \
    && install -d -m 0755 /run/sshd \
    # Unlock the account for key-only SSH login (UsePAM no rejects locked accounts).
    && usermod -p '*' node \
    && install -d -m 0700 -o node -g node /home/node/.ssh

COPY sshd_config /etc/ssh/sshd_config
COPY entrypoint.sh /usr/local/bin/orca-docker-ssh-entrypoint
RUN chmod 0755 /usr/local/bin/orca-docker-ssh-entrypoint

USER node
# Public clone: no token needed at build time. origin is the fork (fetch + push), upstream is read-only.
RUN git clone --filter=blob:none --branch "$REPO_REF" "$REPO_URL" "$PROJECT_ROOT" \
    && git -C "$PROJECT_ROOT" remote add upstream "$UPSTREAM_URL" \
    && git config --global --add safe.directory '*' \
    # Warm the npm cache so per-worktree setup is mostly offline.
    && cd "$PROJECT_ROOT" && npm ci --no-audit --no-fund \
    && cd "$PROJECT_ROOT/messages" && npm ci --no-audit --no-fund

USER root
EXPOSE 22
ENTRYPOINT ["/usr/local/bin/orca-docker-ssh-entrypoint"]
