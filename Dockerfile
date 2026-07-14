# Public-demo image: Vouchsafe attestor-service (4-act frontend + read APIs + MetaMask writes).
# Defaults to READ_ONLY=1 so no server key is needed or exposed; run with READ_ONLY=0 + a funded
# PRIVATE_KEY for the full issuer/fraud write paths.
FROM node:24-slim
WORKDIR /app

# Workspace manifests first for layer-cached installs (contracts workspace intentionally omitted —
# the service only needs its deployments JSON, not the hardhat toolchain).
COPY package.json yarn.lock ./
COPY tee-extension/package.json tee-extension/
COPY attestor-service/package.json attestor-service/
RUN yarn install --ignore-engines --network-timeout 600000 && yarn cache clean

COPY tee-extension tee-extension
COPY attestor-service attestor-service
COPY contracts/deployments contracts/deployments
RUN yarn workspace @vouchsafe/tee-extension build

ENV READ_ONLY=1 \
    ATTESTOR_SERVICE_PORT=7900
EXPOSE 7900
USER node
CMD ["yarn", "workspace", "@vouchsafe/attestor-service", "start"]
