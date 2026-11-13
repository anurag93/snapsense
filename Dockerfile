FROM python:3.12-slim

# Hugging Face Spaces runs containers as user 1000
RUN useradd -m -u 1000 user
WORKDIR /app

COPY backend/requirements.txt backend/requirements.txt
# RapidOCR pulls in opencv-python, which needs desktop GUI libraries.
# The headless build does the same job without them.
RUN pip install --no-cache-dir -r backend/requirements.txt \
    && pip uninstall -y opencv-python \
    && pip install --no-cache-dir opencv-python-headless \
    && python -m spacy download en_core_web_sm

COPY . .
RUN cd backend && python -m app.fetch_model && chown -R user /app

USER user
ENV PORT=7860
EXPOSE 7860
CMD ["sh", "-c", "cd backend && uvicorn app.main:app --host 0.0.0.0 --port ${PORT}"]
