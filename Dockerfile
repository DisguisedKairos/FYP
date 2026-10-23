# syntax=docker/dockerfile:1
FROM python:3.13-slim-bookworm AS fraud
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 FRAUD_HOST=0.0.0.0 FRAUD_PORT=4011
WORKDIR /app
COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt \
    && groupadd --gid 10001 scorer \
    && useradd --uid 10001 --gid scorer --no-create-home scorer
COPY main.py ./
COPY fraud_service/ ./fraud_service/
COPY services/fraud/model.json ./services/fraud/model.json
COPY deploy/fraud.py ./deploy/fraud.py
USER scorer
EXPOSE 4011
HEALTHCHECK --interval=10s --timeout=5s --start-period=15s --retries=6 \
  CMD ["python", "-B", "deploy/fraud.py", "--health"]
CMD ["python", "-B", "deploy/fraud.py"]

FROM node:22-bookworm-slim AS banking
ENV NODE_ENV=production HOST=0.0.0.0 PORT=3000 SEED_DEMO=false
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts --no-audit --no-fund && npm cache clean --force
COPY app.js db.js ./
COPY banking/ ./banking/
COPY database/ ./database/
COPY models/errors.js ./models/errors.js
COPY services/fraud/model.json ./services/fraud/model.json
COPY public/ ./public/
COPY views/ ./views/
COPY scripts/seed-demo.js ./scripts/seed-demo.js
COPY scripts/create-staff.js ./scripts/create-staff.js
COPY deploy/*.js ./deploy/
USER node
EXPOSE 3000
HEALTHCHECK --interval=10s --timeout=5s --start-period=20s --retries=6 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:3000/health',{signal:AbortSignal.timeout(3000)}).then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"]
CMD ["node", "deploy/banking.js"]
