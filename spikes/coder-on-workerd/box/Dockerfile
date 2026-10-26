# apps/maker/image/build.ts as a Dockerfile: the Coder's box as a Cloudflare Container. Build context is
# apps/maker/image (run `pnpm -F maker build:runtime` first for runtime.js and littlejs.d.ts). E2B's fromNodeImage("24")
# is the full node:24 image.
FROM node:24
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg && rm -rf /var/lib/apt/lists/*
ENV PLAYWRIGHT_BROWSERS_PATH=/opt/hopon/browsers
RUN mkdir -p /opt/hopon /workspace \
  && cd /opt/hopon && npm init -y >/dev/null && npm pkg set type=module \
  && npm install esbuild@0.28.2 playwright-core@1.58.2 typescript@6.0.3 \
  && npx playwright-core install --with-deps chromium-headless-shell
# @cloudflare/sandbox's Files runs this helper through exec(); its tag must match the installed package (1.0.3).
COPY --from=docker.io/cloudflare/sandbox:1.0.3 /usr/local/bin/sandbox-shim /usr/local/bin/sandbox-shim
COPY browser.js dom.d.ts dom.js helpers.js littlejs.d.ts page.ts playtest.js runtime.js /opt/hopon/
RUN useradd -m -u 1001 user && chown -R user:user /workspace
USER user
WORKDIR /workspace
CMD ["node", "/opt/hopon/browser.js"]
