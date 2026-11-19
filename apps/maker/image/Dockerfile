# The Maker's box (#175): node, python3, Chromium, ffmpeg, typescript and the box scripts under /opt/hopon, and for
# the music-sf2 skill FluidSynth, midiutil, numpy and the GeneralUser GS bank (its license: "use without restriction").
# apps/worker/wrangler.jsonc builds it from this directory, and `wrangler deploy` pushes it;
# `pnpm -F maker build:runtime` makes runtime.js and littlejs.d.ts first. It runs with no internet and no secrets.
FROM node:24-slim
RUN apt-get update \
  && apt-get install -y --no-install-recommends ffmpeg fluidsynth python3 python3-midiutil python3-numpy \
  && rm -rf /var/lib/apt/lists/*
ENV PLAYWRIGHT_BROWSERS_PATH=/opt/hopon/browsers
RUN mkdir -p /opt/hopon /workspace \
  && cd /opt/hopon && npm init -y >/dev/null && npm pkg set type=module \
  && npm install esbuild@0.28.2 playwright-core@1.58.2 typescript@6.0.3 \
  && npx playwright-core install --with-deps chromium-headless-shell \
  && rm -rf /var/lib/apt/lists/* /root/.npm
# Vite games (ADR 0007): Vite and the libraries, with their types, resolvable from /workspace through /node_modules,
# since Node and Vite look up the tree from the project to /. A game's build leaves the libraries as imports of the
# Worker's /vendor/ files, built from these same versions (apps/maker/vendor/build.ts; src/vendor.test.ts checks), so the
# box needs their code only to typecheck. Phaser's source, tests and docs aren't its build or types. vite and tsc go on
# the PATH of exec'd commands and of a model's login shell, whose /etc/profile resets it.
RUN cd /opt/hopon && npm install --no-audit --no-fund \
    vite@8.3.8 @vitejs/plugin-react@6.3.0 \
    react@19.3.1 react-dom@19.3.1 phaser@4.2.1 three@0.187.0 @react-three/fiber@9.8.2 \
    @types/react@19.3.0 @types/react-dom@19.3.0 @types/three@0.187.0 \
  && rm -rf /root/.npm node_modules/phaser/src node_modules/phaser/tests node_modules/phaser/docs node_modules/phaser/changelog \
  && ln -s /opt/hopon/node_modules /node_modules \
  && echo 'PATH="/opt/hopon/node_modules/.bin:$PATH"' > /etc/profile.d/hopon.sh
ENV PATH=/opt/hopon/node_modules/.bin:$PATH
ADD https://raw.githubusercontent.com/mrbumpy409/GeneralUser-GS/684543d5e5efaef08d02be50dcda8d552478fa60/GeneralUser-GS.sf2 /opt/hopon/GeneralUser-GS.sf2
RUN echo "9575028c7a1f589f5770fccc8cff2734566af40cd26ed836944e9a5152688cfe  /opt/hopon/GeneralUser-GS.sf2" | sha256sum -c - \
  && chmod 644 /opt/hopon/GeneralUser-GS.sf2
# @cloudflare/sandbox's Files runs this helper through exec(); its tag is apps/worker's @cloudflare/sandbox version
# (test/previews.test.js checks).
COPY --from=docker.io/cloudflare/sandbox:1.0.3 /usr/local/bin/sandbox-shim /usr/local/bin/sandbox-shim
COPY assets.d.ts browser.js dom.d.ts dom.js helpers.js hopon.js hopon-v1.d.ts littlejs.d.ts page.ts playtest.js runtime.js vendor.json verify.js /opt/hopon/
RUN useradd -m -u 1001 user && chown -R user:user /workspace
USER user
WORKDIR /workspace
CMD ["node", "/opt/hopon/browser.js"]
