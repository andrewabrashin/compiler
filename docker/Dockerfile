FROM compiler.ru:core

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

# Log directory
RUN mkdir -p /log

WORKDIR /app
