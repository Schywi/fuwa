docker_compose("infra/docker-compose/dev.yml")

dc_resource("fuwa", port_forwards=["8080:8080"])
dc_resource("vector-router", port_forwards=["8686:8686", "8687:8687"])
dc_resource("victoriametrics", port_forwards=["8428:8428"])
dc_resource("clickhouse", port_forwards=["8123:8123", "9000:9000"])
dc_resource("uptrace", port_forwards=["14317:14317", "14318:14318"])
