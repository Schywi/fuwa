CREATE DATABASE IF NOT EXISTS otel;

CREATE TABLE IF NOT EXISTS otel.otel_spans
(
  timestamp DateTime64(9, 'UTC'),
  trace_id String,
  span_id String,
  parent_span_id String,
  span_name LowCardinality(String),
  span_kind LowCardinality(String),
  service_name LowCardinality(String),
  deployment_environment LowCardinality(String),
  http_route LowCardinality(String),
  http_method LowCardinality(String),
  http_status_code UInt16,
  otel_status_code LowCardinality(String),
  duration_ms Float64,
  sample_rate Float64 DEFAULT 1.0,
  attributes_json String,
  resources_json String
)
ENGINE = MergeTree
PARTITION BY toDate(timestamp)
ORDER BY (service_name, span_name, timestamp, trace_id)
TTL timestamp + INTERVAL 7 DAY
SETTINGS index_granularity = 8192;

CREATE TABLE IF NOT EXISTS otel.otel_logs
(
  timestamp DateTime64(9, 'UTC'),
  trace_id String,
  span_id String,
  service_name LowCardinality(String),
  deployment_environment LowCardinality(String),
  severity_text LowCardinality(String),
  severity_number UInt8,
  message String,
  attributes_json String,
  resources_json String
)
ENGINE = MergeTree
PARTITION BY toDate(timestamp)
ORDER BY (service_name, severity_text, timestamp, trace_id)
TTL timestamp + INTERVAL 7 DAY
SETTINGS index_granularity = 8192;
