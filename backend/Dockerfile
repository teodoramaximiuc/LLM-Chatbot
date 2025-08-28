FROM python:3.11-slim
WORKDIR /app

ARG VITE_BOOK_API_BASE=http://localhost:8000
ENV VITE_BOOK_API_BASE=$VITE_BOOK_API_BASE

# dependențe OS minime (certs + tzdata)
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates tzdata && \
    rm -rf /var/lib/apt/lists/*

# Python deps
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# cod + date
COPY server.py ./server.py
COPY book_sum.json ./book_sum.json

# directoare pentru ChromaDB + imagini generate
RUN mkdir -p /app/chroma_db /app/static
VOLUME ["/app/chroma_db","/app/static"]

EXPOSE 8000
CMD ["uvicorn", "server:app", "--host", "0.0.0.0", "--port", "8000"]
