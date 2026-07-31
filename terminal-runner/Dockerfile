FROM node:22-bookworm-slim

RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ bash \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev --ignore-scripts=false
COPY server.js ./

RUN mkdir -p /workspace /tmp/jobly-terminal \
  && chown -R node:node /workspace /tmp/jobly-terminal /app

USER node
ENV NODE_ENV=production \
    PORT=4100 \
    HOME=/workspace \
    TERM=xterm-256color
EXPOSE 4100
CMD ["node", "server.js"]
