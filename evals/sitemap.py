"""Tests for converting a flat local sitemap to an approved-page candidate list."""
from pathlib import Path
import sys
from tempfile import TemporaryDirectory
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
from sitemap_urls import candidates  # noqa: E402


class SitemapTest(unittest.TestCase):
    def parse(self, content):
        with TemporaryDirectory() as temp:
            path = Path(temp) / "sitemap.xml"
            path.write_text(content, encoding="utf-8")
            return list(candidates(path, "https://example.org"))

    def test_scope_and_deduplication(self):
        urls = [
            "https://example.org/services/", "https://outside.example/services/",
            "https://example.org/services/", "https://example.org/faq/",
            "https://example.org/private?key=fixture",
        ]
        links = "".join(f"<url><loc>{url}</loc></url>" for url in urls)
        xml = f'<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">{links}</urlset>'
        self.assertEqual(self.parse(xml), ["https://example.org/services/", "https://example.org/faq/"])

    def test_dtd_and_index_rejected(self):
        for document in ["<!DOCTYPE urlset><urlset/>", "<sitemapindex/>"]:
            with self.assertRaises(ValueError):
                self.parse(document)


if __name__ == "__main__":
    unittest.main()
