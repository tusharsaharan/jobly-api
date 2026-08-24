FROM node:22-bookworm-slim

RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ bash fish \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev --ignore-scripts=false
COPY server.js ./

RUN mkdir -p /workspace \
  /tmp/jobly-terminal/config/fish \
  /tmp/jobly-terminal/data/fish \
  /tmp/jobly-terminal/state/fish \
  /tmp/jobly-terminal/cache \
  && chown -R node:node /workspace /tmp/jobly-terminal /app

USER node
ENV NODE_ENV=production \
    PORT=4100 \
    HOME=/workspace \
    XDG_CONFIG_HOME=/tmp/jobly-terminal/config \
    XDG_DATA_HOME=/tmp/jobly-terminal/data \
    XDG_STATE_HOME=/tmp/jobly-terminal/state \
    XDG_CACHE_HOME=/tmp/jobly-terminal/cache \
    TERM=xterm-256color
EXPOSE 4100
CMD ["node", "server.js"]
