FROM node:20-slim

# Install Chromium and minimal required deps for puppeteer-core
RUN apt-get update && apt-get install -y --no-install-recommends \
    chromium \
    fonts-liberation \
    libnss3 \
    libatk-bridge2.0-0 \
    libdrm2 \
    libgbm1 \
    libx11-xcb1 \
    libxcomposite1 \
    libxdamage1 \
    libxrandr2 \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium
# Listen on all interfaces (required for Render / Docker)
ENV HOST=0.0.0.0

WORKDIR /app

COPY package*.json ./
# NODE_ENV=production before npm ci skips devDependencies — tsc/vite missing → build exit 127
RUN npm ci

COPY . .
# Required for Vite client bundle (set in Render as Docker build args or same-name envs)
ARG VITE_SUPABASE_URL
ARG VITE_SUPABASE_ANON_KEY
ARG VITE_GEOAPIFY_API_KEY
ENV VITE_SUPABASE_URL=$VITE_SUPABASE_URL
ENV VITE_SUPABASE_ANON_KEY=$VITE_SUPABASE_ANON_KEY
ENV VITE_GEOAPIFY_API_KEY=$VITE_GEOAPIFY_API_KEY
RUN npm run build
# Drop devDependencies for a smaller runtime image; keeps puppeteer-core in dependencies
RUN npm prune --omit=dev

ENV NODE_ENV=production

EXPOSE 3000

CMD ["node", "server/app-server.mjs"]
