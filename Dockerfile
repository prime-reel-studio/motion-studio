FROM ubuntu:22.04
ENV DEBIAN_FRONTEND=noninteractive
RUN apt-get update && apt-get install -y --no-install-recommends curl ca-certificates xz-utils ffmpeg fontconfig python3 python3-pil libraqm0 && rm -rf /var/lib/apt/lists/*
RUN curl -fsSL https://nodejs.org/dist/v20.18.1/node-v20.18.1-linux-x64.tar.xz | tar -xJ -C /usr/local --strip-components=1
RUN python3 -c "from PIL import features; assert features.check('raqm'), 'Arabic shaping unavailable'"
WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev
COPY . .
ENV PORT=7860
EXPOSE 7860
CMD ["node", "server.js"]
