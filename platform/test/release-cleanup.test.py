import importlib.util
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('cleanup', Path(__file__).parents[1] / 'deploy/prune-releases.py')
cleanup = importlib.util.module_from_spec(spec)
spec.loader.exec_module(cleanup)


class CleanupScopeTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name).resolve()
        self.releases = self.root / 'releases'
        self.releases.mkdir()
        self.old = self.releases / '20260908-old'
        self.current = self.releases / '20260920-current'
        self.old.mkdir()
        self.current.mkdir()
        (self.root / 'current').symlink_to(self.current)

    def test_only_old_managed_directories_are_selected(self):
        (self.releases / 'customer-data').mkdir()
        (self.releases / '20260909-link').symlink_to(self.old)
        active, old = cleanup.candidates(self.root)
        self.assertEqual(active, self.current)
        self.assertEqual(old, [self.old])

    def test_current_outside_release_root_is_rejected(self):
        (self.root / 'current').unlink()
        (self.root / 'current').symlink_to(self.root)
        with self.assertRaisesRegex(RuntimeError, 'current_must_point'):
            cleanup.candidates(self.root)

    def test_current_dependency_symlink_prevents_deletion(self):
        (self.current / 'node_modules').symlink_to(self.old)
        with patch.object(Path, 'iterdir', return_value=[]):
            with self.assertRaisesRegex(RuntimeError, 'still_referenced'):
                cleanup.assert_unreferenced([self.old], self.current, [])

    def test_container_mount_prevents_deletion(self):
        with patch.object(Path, 'iterdir', return_value=[]):
            with self.assertRaisesRegex(RuntimeError, 'still_referenced'):
                cleanup.assert_unreferenced([self.old], self.current,
                    [{'Mounts': [{'Source': str(self.old / 'platform')}]}])


if __name__ == '__main__':
    unittest.main()
