import importlib.util
import json
import os
import tempfile
import unittest
import zipfile
from unittest import mock


ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
IMPORTER_PATH = os.path.join(ROOT, "scripts", "clo_import_furlab.py")


def load_importer():
    spec = importlib.util.spec_from_file_location("clo_import_furlab", IMPORTER_PATH)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class FakeFabricApi:
    def __init__(self):
        self.added = []

    def GetFabricCount(self, include_archived):
        self.include_archived = include_archived
        return 7

    def AddFabric(self, path):
        self.added.append(path)
        return 100 + len(self.added)


class FakePatternApi:
    def __init__(self):
        self.created = []
        self.grain = []
        self.fabric = []

    def GetPatternCount(self):
        return 20

    def CreatePatternWithPoints(self, points):
        self.created.append(points)

    def SetPatternPieceGrainDirection(self, pattern_index, angle):
        self.grain.append((pattern_index, angle))

    def SetPatternPieceFabricIndex(self, pattern_index, fabric_index):
        self.fabric.append((pattern_index, fabric_index))


def make_dxf(points):
    lines = ["0", "SECTION", "2", "ENTITIES", "0", "LWPOLYLINE", "8", "FRAGMENT_CONTOUR"]
    for p in points:
        lines.extend(["10", str(p["x"]), "20", str(p["y"])])
    lines.extend(["0", "ENDSEC", "0", "EOF"])
    return "\n".join(lines)


def build_zip(entries, files):
    tmp_dir = tempfile.mkdtemp(prefix="furlab_clo_import_test_")
    zip_path = os.path.join(tmp_dir, "furlab_export_mock.zip")
    manifest = {"entries": entries}
    with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED) as zf:
        zf.writestr("manifest.json", json.dumps(manifest, ensure_ascii=False))
        for name, data in files.items():
            zf.writestr(name, data)
    return zip_path


class CloImportMockTest(unittest.TestCase):
    def test_imports_manifest_points_and_assigns_material(self):
        importer = load_importer()
        zip_path = build_zip(
            entries=[
                {
                    "fragmentId": "frag_a",
                    "zoneId": 1,
                    "napDirectionDeg": 45,
                    "materialJfabPath": "materials/белый.jfab",
                    "points": [
                        {"x": 0, "y": 0},
                        {"x": 100, "y": 0},
                        {"x": 100, "y": 50},
                        {"x": 0, "y": 50},
                    ],
                },
                {
                    "fragmentId": "bad",
                    "zoneId": 1,
                    "materialJfabPath": "materials/белый.jfab",
                    "points": [{"x": 0, "y": 0}, {"x": 1, "y": 1}],
                },
            ],
            files={"materials/белый.jfab": json.dumps({"qsName": "white"})},
        )
        fabric = FakeFabricApi()
        pattern = FakePatternApi()

        result = importer.run_import(zip_path, fabric, pattern)

        self.assertTrue(result["ok"])
        self.assertEqual(result["created"], 1)
        self.assertEqual(result["skipped"], 1)
        self.assertEqual(len(fabric.added), 1)
        self.assertTrue(fabric.added[0].endswith(os.path.join("materials", "белый.jfab")))
        self.assertEqual(len(pattern.created), 1)
        self.assertEqual(len(pattern.created[0]), 4)
        self.assertEqual(pattern.created[0][0][2], 0)
        self.assertTrue(all(y <= 0 for _, y, _ in pattern.created[0]))
        self.assertEqual(pattern.grain, [(20, 45.0)])
        self.assertEqual(pattern.fabric, [(20, 101)])

    def test_falls_back_to_dxf_when_manifest_has_no_points(self):
        importer = load_importer()
        dxf_points = [
            {"x": 0, "y": 0},
            {"x": 20, "y": 0},
            {"x": 20, "y": 10},
            {"x": 0, "y": 10},
        ]
        zip_path = build_zip(
            entries=[
                {
                    "fragmentId": "frag_dxf",
                    "zoneId": 2,
                    "napDirectionDeg": 90,
                    "dxfPath": "fragments/zone/frag.dxf",
                },
            ],
            files={"fragments/zone/frag.dxf": make_dxf(dxf_points)},
        )
        result = importer.run_import(zip_path, FakeFabricApi(), FakePatternApi())

        self.assertTrue(result["ok"])
        self.assertEqual(result["created"], 1)

    def test_reports_missing_manifest(self):
        importer = load_importer()
        tmp_dir = tempfile.mkdtemp(prefix="furlab_clo_import_test_")
        zip_path = os.path.join(tmp_dir, "bad.zip")
        with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED) as zf:
            zf.writestr("readme.txt", "no manifest")

        result = importer.run_import(zip_path, FakeFabricApi(), FakePatternApi())

        self.assertFalse(result["ok"])
        self.assertEqual(result["error"], "manifest_not_found")

    def test_download_latest_zip_fallback_writes_temp_zip(self):
        importer = load_importer()
        zip_path = build_zip(entries=[], files={})
        with open(zip_path, "rb") as f:
            zip_bytes = f.read()

        class FakeResponse:
            def __enter__(self):
                return self

            def __exit__(self, exc_type, exc, tb):
                return False

            def read(self):
                return zip_bytes

        with mock.patch.object(importer.urllib.request, "urlopen", return_value=FakeResponse()) as urlopen:
            downloaded = importer.download_latest_zip()

        self.assertTrue(os.path.exists(downloaded))
        self.assertEqual(os.path.basename(downloaded), "furlab_export_latest.zip")
        self.assertTrue(downloaded.endswith(".zip"))
        urlopen.assert_called_once()


if __name__ == "__main__":
    unittest.main(verbosity=2)
