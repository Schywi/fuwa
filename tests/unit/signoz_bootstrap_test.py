import importlib.util
import pathlib
import unittest


def load_bootstrap_module():
    repo_root = pathlib.Path(__file__).resolve().parents[2]
    module_path = repo_root / "infra" / "docker-compose" / "signoz-bootstrap.py"
    spec = importlib.util.spec_from_file_location("signoz_bootstrap", module_path)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


bootstrap = load_bootstrap_module()


class DashboardShapeTests(unittest.TestCase):
    def test_extract_dashboard_title_supports_nested_malformed_seed(self):
        dashboard = {
            "data": {
                "data": {
                    "title": "Fuwa Overview",
                },
                "version": "v5",
            }
        }

        self.assertEqual(bootstrap.extract_dashboard_title(dashboard), "Fuwa Overview")

    def test_dashboard_needs_repair_for_nested_seed_shape(self):
        dashboard = {
            "data": {
                "data": {
                    "title": "Fuwa Overview",
                },
                "version": "v5",
            }
        }

        self.assertTrue(bootstrap.dashboard_needs_repair(dashboard))

    def test_dashboard_needs_repair_is_false_for_flat_shape(self):
        dashboard = {
            "data": {
                "title": "Fuwa Overview",
                "description": "ok",
                "uploadedGrafana": False,
                "version": "v5",
                "spec": {"panels": []},
            }
        }

        self.assertFalse(bootstrap.dashboard_needs_repair(dashboard))


class PayloadQualificationTests(unittest.TestCase):
    def test_qualify_payload_emits_widget_layout_dashboard_shape(self):
        payload = bootstrap.qualify_payload(
            {
                "title": "Fuwa Overview",
                "description": "overview",
                "tags": ["fuwa"],
            }
        )

        self.assertEqual(payload["title"], "Fuwa Overview")
        self.assertEqual(payload["description"], "overview")
        self.assertIn("uploadedGrafana", payload)
        self.assertEqual(payload["version"], "v5")
        self.assertIn("layout", payload)
        self.assertIn("widgets", payload)
        self.assertEqual(len(payload["layout"]), 3)
        self.assertEqual(len(payload["widgets"]), 3)
        self.assertNotIn("spec", payload)
        self.assertNotIn("data", payload)

    def test_build_create_payload_omits_nested_dashboard_data(self):
        payload = bootstrap.build_create_payload(
            {
                "title": "Fuwa Overview",
                "description": "overview",
                "widgets": [{"title": "hello"}],
                "uploadedGrafana": False,
                "version": "v5",
            }
        )

        self.assertEqual(
            payload,
            {
                "title": "Fuwa Overview",
                "description": "overview",
                "uploadedGrafana": False,
                "version": "v5",
            },
        )

    def test_qualify_payload_keeps_real_widget_dashboards(self):
        payload = bootstrap.qualify_payload(
            {
                "title": "Existing",
                "description": "ok",
                "layout": [{"i": "abc", "w": 4, "h": 4, "x": 0, "y": 0}],
                "widgets": [{"id": "abc", "title": "hello"}],
            }
        )

        self.assertEqual(payload["layout"][0]["i"], "abc")
        self.assertEqual(payload["widgets"][0]["id"], "abc")


if __name__ == "__main__":
    unittest.main()
