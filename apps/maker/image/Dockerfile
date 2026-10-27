# The Coder's box (#175): node, Chromium, ffmpeg, typescript and the box scripts under /opt/hopon, as image/build.ts's
# E2B template had them. apps/worker/wrangler.jsonc builds it from this directory, and `wrangler deploy` pushes it;
# `pnpm -F maker build:runtime` makes runtime.js and littlejs.d.ts first. It runs with no internet and no secrets.
FROM node:24-slim
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg && rm -rf /var/lib/apt/lists/*
ENV PLAYWRIGHT_BROWSERS_PATH=/opt/hopon/browsers
RUN mkdir -p /opt/hopon /workspace \
  && cd /opt/hopon && npm init -y >/dev/null && npm pkg set type=module \
  && npm install esbuild@0.28.2 playwright-core@1.58.2 typescript@6.0.3 \
  && npx playwright-core install --with-deps chromium-headless-shell \
  && rm -rf /var/lib/apt/lists/* /root/.npm
# @cloudflare/sandbox's Files runs this helper through exec(); its tag is apps/worker's @cloudflare/sandbox version
# (test/previews.test.js checks).
COPY --from=docker.io/cloudflare/sandbox:1.0.3 /usr/local/bin/sandbox-shim /usr/local/bin/sandbox-shim
COPY browser.js dom.d.ts dom.js helpers.js littlejs.d.ts page.ts playtest.js runtime.js /opt/hopon/
RUN useradd -m -u 1001 user && chown -R user:user /workspace
USER user
WORKDIR /workspace
CMD ["node", "/opt/hopon/browser.js"]
