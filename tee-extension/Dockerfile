# Confidential Space workload image for the Vouchsafe TEE extension.
# The image DIGEST (not the tag) is the enclave's identity: the Confidential Space attestation token
# binds this exact digest to real TEE hardware, and relying parties whitelist that digest.
# Build context = tee-extension/ (the package installs standalone; no other workspace is needed).

FROM node:24-slim AS build
WORKDIR /app
COPY package.json ./
RUN yarn install --ignore-engines --network-timeout 600000
COPY tsconfig.json ./
COPY src ./src
RUN yarn build

FROM node:24-slim
# Confidential Space launch policy: allow workload stdout/stderr redirection to Cloud Logging on the
# production (non-debug) image — without this label the launcher refuses to boot with log redirect.
LABEL "tee.launch_policy.log_redirect"="always"
# MODE=0 + no TEE_SIGNER_PRIVATE_KEY: the signing key is generated inside the enclave at boot and
# never leaves it. The operator reads the address from /pubkey and registers it via setTeeAddress.
ENV NODE_ENV=production \
    MODE=0 \
    SIMULATED_TEE=false \
    TEE_EXTENSION_PORT=7800
WORKDIR /app
COPY package.json ./
RUN yarn install --ignore-engines --production --network-timeout 600000 && yarn cache clean
COPY --from=build /app/dist ./dist
EXPOSE 7800
USER node
CMD ["node", "dist/index.js"]
