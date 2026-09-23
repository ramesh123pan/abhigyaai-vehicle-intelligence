# Project continuity

Common features must use shared architecture: shared layout source, shared account controls, session.js for expired sessions, and /login for sign-in. Do not introduce page-specific login forms or copies of the application shell.

Read PROJECT_MEMORY.md, PROJECT_PROFILE.md, and EXTERNAL_API.md before working on this project. Consult related project chats when context is missing.

After every implementation update, update the affected Markdown documentation and project profile before handoff. Record changed behavior, actual verification, unresolved issues, and whether a server restart was verified. Never label a syntax check as a successful browser test. Never copy secrets into notes.

For routing fixes, verify direct navigation, reload, sidebar navigation, and browser back/forward. Confirm the correct key's content is visible, not merely that the URL changed. Do not declare completion based on redirects or delayed callbacks alone.

Restart only the verified process serving this workspace on port 4173; do not stop unrelated Node servers. A startup log is not proof the port is still listening. Restarting clears in-memory sessions.
