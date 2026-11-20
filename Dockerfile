FROM node:22.18.0-slim

# Install dependencies for building (node-gyp etc if needed) and for assets (ffmpeg)
RUN apt-get update && apt-get install -y \
    python3 \
    make \
    g++ \
    ffmpeg \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy package files first for caching
COPY package*.json ./

# Install dependencies
RUN npm install --legacy-peer-deps

# Copy the rest of the application
COPY . .

# Build the frontend assets
RUN npm run build

# Set production environment
ENV NODE_ENV=production

# Expose the default port
EXPOSE 3000

# Start the server
CMD ["npm", "start"]
