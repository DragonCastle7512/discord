FROM node:23-slim

RUN apt-get update && apt-get install -y \
    python3 \
    make \
    g++ \
    build-essential \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package*.json ./

RUN npm install --omit=dev --loglevel info

COPY . .

ENV NODE_ENV=production

CMD ["node", "index.js"]