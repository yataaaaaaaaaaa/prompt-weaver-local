"""Outgoing HTTP: the only place that builds httpx clients (user agent, timeouts, redirects).

Services receive an HttpClientFactory and open one short-lived client per operation:

    with self._client_factory() as client:
        response = client.get(url, params=..., headers=...)

Tests inject a factory over httpx.MockTransport (tests/support.py FakeHttp); tests/conftest.py makes every
app built by the `app` fixture use it, so no test can reach the real network.
"""

from __future__ import annotations

import logging
from collections.abc import Callable

import httpx

HttpClientFactory = Callable[[], httpx.Client]

# httpx logs every request URL at INFO; download URLs are signed storage URLs (credentials in the query
# string), so they must never reach a log even if logging is later configured at INFO.
logging.getLogger("httpx").setLevel(logging.WARNING)

USER_AGENT = "PromptWeaverLocal/0.2"
# Long reads: model downloads stream multi-GB bodies; a stalled read still fails after 60 s.
DEFAULT_TIMEOUT = httpx.Timeout(connect=15.0, read=60.0, write=60.0, pool=15.0)


def default_http_client() -> httpx.Client:
    """httpx client used in production. Redirects are followed (httpx drops the Authorization header when a
    redirect leaves the original host, e.g. Civitai -> its storage CDN)."""
    return httpx.Client(headers={"User-Agent": USER_AGENT}, timeout=DEFAULT_TIMEOUT, follow_redirects=True)


def describe_http_error(exc: httpx.HTTPError) -> str:
    """User-facing text for an httpx error. Never str(exc): it may quote the (possibly signed) URL."""
    if isinstance(exc, httpx.TimeoutException):
        return "The connection timed out"
    if isinstance(exc, httpx.ConnectError):
        return "Could not connect to the server"
    if isinstance(exc, (httpx.ReadError, httpx.WriteError, httpx.RemoteProtocolError)):
        return "The connection was interrupted"
    if isinstance(exc, httpx.TooManyRedirects):
        return "Too many redirects"
    return f"Network error ({type(exc).__name__})"
