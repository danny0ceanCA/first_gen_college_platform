# Build only in a credential-free reviewed image pipeline. Supply a verified Node 22 image digest.
ARG NODE_IMAGE
FROM ${NODE_IMAGE}
ARG LOCK_DIGEST
ARG PROFILE_DIGEST
WORKDIR /opt/deps
COPY package.json package-lock.json ./
RUN test "$(node -p 'process.versions.node.split(".")[0]')" = 22 && npm ci --ignore-scripts --no-audit --no-fund && npm cache clean --force
COPY ops/diagnostic-runner/entrypoint.mjs ops/diagnostic-runner/profiles.mjs /runner/
LABEL org.origen.lock=${LOCK_DIGEST} org.origen.profiles=${PROFILE_DIGEST}
USER 65532:65532
WORKDIR /workspace
ENTRYPOINT ["node", "/runner/entrypoint.mjs"]
