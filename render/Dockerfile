FROM python:3.12

# System deps: Go, C++, curl
RUN apt-get update && apt-get install -y -q --no-install-recommends \
    golang gcc gcc-multilib g++ curl ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Node.js 22 LTS via NodeSource
RUN curl -fsSL https://deb.nodesource.com/setup_22.x | bash - \
    && apt-get install -y nodejs \
    && rm -rf /var/lib/apt/lists/*

# Global npm tools
RUN npm i -g yarn typescript ts-node @types/node

# Python ML libraries
# NOTE: torch + tensorflow + ultralytics ~15 GB — build takes ~20-30 min
RUN pip install --no-cache-dir --upgrade pip && pip install --no-cache-dir \
    aiohttp aiohttp_cors \
    lxml \
    matplotlib \
    numpy \
    opencv-python opencv-python-headless \
    pandas \
    requests \
    scikit-learn \
    tensorflow \
    torch \
    ultralytics

# Student user (student code runs under this account)
RUN useradd -rm -d /home/student -s /bin/bash -u 1001 student \
    && mkdir -p /home/student/tests \
    && chown -R student:student /home/student

# Log directory (ephemeral on render.com — add Render Disk for persistence)
RUN mkdir -p /log

WORKDIR /app

# Copy server source into image (no volume mount on render.com)
COPY data/src/ .

# Install npm dependencies
RUN npm ci --omit=dev \
    && chown -R root:root /app \
    && chmod -R o-rwx /app

EXPOSE 3999

CMD ["node", "/app/launch.js"]
