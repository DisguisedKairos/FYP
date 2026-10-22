FROM node:22-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production HOST=0.0.0.0 DATA_DIR=/app/data
COPY --chown=node:node package.json app.js db.js ./
COPY --chown=node:node controllers ./controllers
COPY --chown=node:node models ./models
COPY --chown=node:node services ./services
COPY --chown=node:node scripts ./scripts
COPY --chown=node:node public ./public
COPY --chown=node:node views ./views
RUN mkdir -p /app/data && chown node:node /app/data
USER node
EXPOSE 3000
CMD ["node", "scripts/start-platform.js"]
