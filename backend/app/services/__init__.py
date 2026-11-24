"""Backend services: domain logic and IO behind the FastAPI routers.

Services receive their paths/collaborators through constructors (see container.build_services)
so every endpoint is testable with TestClient on a temp data dir and a fake generator.
"""
