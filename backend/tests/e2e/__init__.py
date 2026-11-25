"""End-to-end test backend (never imported by production code): `uv run python tests/e2e/server.py --port N`.

server.py runs the real create_app() on a temp data dir seeded from fixtures/data (seed.py), with a paced fake
generator (support.FakeGenerator) and a synthetic Civitai / Hugging Face on support.FakeHttp (fake_civitai.py).
The Playwright suite in frontend/e2e resets it before every test (POST /__e2e__/reset, options.py)."""
