import os
import pathlib
import shlex
import subprocess
import unittest


REPO_ROOT = pathlib.Path(__file__).resolve().parents[2]
SCRIPT_PATH = REPO_ROOT / "infra" / "scripts" / "cilium-lab.sh"


def install_args(extra_env=None):
    env = os.environ.copy()
    if extra_env:
        env.update(extra_env)

    command = f"source {shlex.quote(str(SCRIPT_PATH))}; cilium_install_args"
    result = subprocess.run(
        ["bash", "-lc", command],
        cwd=REPO_ROOT,
        env=env,
        check=True,
        capture_output=True,
        text=True,
    )
    return [line for line in result.stdout.splitlines() if line]


class CiliumLabTests(unittest.TestCase):
    def test_single_node_install_defaults_to_one_operator_replica(self):
        args = install_args()

        self.assertEqual(args[:4], ["upgrade", "--install", "cilium", "cilium/cilium"])
        self.assertIn("operator.replicas=1", args)
        self.assertIn("hubble.relay.enabled=true", args)
        self.assertIn("hubble.ui.enabled=true", args)
        self.assertIn("hubble.ui.service.type=NodePort", args)
        self.assertIn("hubble.ui.service.nodePort=30080", args)
        self.assertEqual(args[-3:], ["--wait", "--timeout", "5m"])

    def test_environment_can_override_replica_count_and_node_port(self):
        args = install_args(
            {
                "CILIUM_OPERATOR_REPLICAS": "2",
                "HUBBLE_NODE_PORT": "30123",
            }
        )

        self.assertIn("operator.replicas=2", args)
        self.assertIn("hubble.ui.service.nodePort=30123", args)


if __name__ == "__main__":
    unittest.main()
