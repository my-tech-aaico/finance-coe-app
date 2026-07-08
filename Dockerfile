FROM node:20-alpine

RUN npm install -g pnpm@9

WORKDIR /app

COPY package.json pnpm-lock.yaml .npmrc ./
RUN pnpm install --frozen-lockfile

COPY tsconfig.json next.config.ts postcss.config.mjs ./
COPY public/ ./public/
COPY src/ ./src/

RUN pnpm build

EXPOSE 3000

# Default: web server. Override for cron jobs: docker run <image> verification-submit|verification-poll
ENTRYPOINT ["pnpm", "run"]
CMD ["start"]
