# The Coder's Container image, built from the repo root by apps/worker/wrangler.jsonc: Node and the Coder's server with
# its production dependencies, and no keys. The game is built and played in the E2B box, not here.
FROM node:24-slim
RUN corepack enable
WORKDIR /hopon
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/maker/package.json apps/maker/
COPY packages/model-fetch/package.json packages/model-fetch/
RUN pnpm install --frozen-lockfile --prod --filter "maker..."
COPY packages/model-fetch/index.ts packages/model-fetch/
COPY apps/maker/agent-home apps/maker/agent-home
COPY apps/maker/src apps/maker/src
COPY apps/maker/image/page.ts apps/maker/image/
WORKDIR /hopon/apps/maker
EXPOSE 8080
CMD ["node", "src/main.ts"]
