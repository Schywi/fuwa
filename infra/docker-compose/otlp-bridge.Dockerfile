FROM python:3.12-alpine
COPY infra/docker-compose/otlp-bridge.py /bridge.py
CMD ["python3", "/bridge.py"]
