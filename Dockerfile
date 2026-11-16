FROM node:24-alpine AS build
WORKDIR /app
COPY package.json ./
RUN npm install --legacy-peer-deps
COPY . .
RUN npm run build

FROM node:24-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production \
    SERVE_CLIENT=false \
    HOST=0.0.0.0 \
    PORT=3000

RUN apk add --no-cache su-exec
COPY package.json ./
RUN npm install --omit=dev --legacy-peer-deps --no-package-lock \
    && npm install pg@^8.16.3 --no-save --no-package-lock --legacy-peer-deps
COPY --from=build /app/dist ./dist
COPY server.ts ./
COPY server ./server
COPY src/shared ./src/shared
COPY content ./content
COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh \
    && mkdir -p /app/data \
    && chown -R node:node /app

EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

ENTRYPOINT ["docker-entrypoint.sh"]
CMD ["node", "server.ts"]
