FROM python:3.11-alpine
WORKDIR /app
COPY infra/docker-compose/signoz-bootstrap.py /app/signoz-bootstrap.py
CMD ["python3", "-u", "/app/signoz-bootstrap.py"]
