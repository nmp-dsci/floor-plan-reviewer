FROM node:24-slim
WORKDIR /app
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci --no-fund --no-audit
COPY frontend/ .
EXPOSE 5173
CMD ["npm", "run", "dev"]
