# Base image Node.js + Alpine
FROM node:20-alpine

# Cài FFmpeg
RUN apk add --no-cache ffmpeg bash

# Tạo thư mục app
WORKDIR /usr/src/app

# Copy package.json và cài dependencies
COPY package*.json ./
RUN npm install

# Copy source code
COPY . .

# Tạo folder uploads
RUN mkdir -p uploads/original uploads/hls

# Expose port
EXPOSE 4000

# Chạy app
CMD ["node", "server.js"]
