FROM node:20-slim

WORKDIR /app

COPY control-plane/ control-plane/
COPY node-agent/ node-agent/
COPY ui/ ui/
COPY cli/ cli/
COPY pocket/ pocket/
COPY config/ config/
COPY allowlists/ allowlists/
COPY policies/ policies/
COPY tripwires/ tripwires/
COPY skills/ skills/
COPY scripts/ scripts/
COPY package.json .

RUN mkdir -p /data

ENV NODE_ENV=production

EXPOSE 3400

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3400/healthz', r => { process.exit(r.statusCode === 200 ? 0 : 1) }).on('error', () => process.exit(1))"

CMD ["node", "control-plane/server.js"]
