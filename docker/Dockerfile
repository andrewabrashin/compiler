FROM compiler.ru:core

RUN pip install --no-cache-dir --upgrade pip && \
    pip install \
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

RUN useradd -rm -d /home/student -s /bin/bash -u 1001 student

WORKDIR /app
