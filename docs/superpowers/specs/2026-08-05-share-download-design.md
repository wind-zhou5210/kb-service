# Share Download Feature Specification

## Overview

Add download functionality to shared collection and document links, enabling recipients to download individual files or the entire collection as a ZIP archive.

## Goals
- Allow users to download a single document from a shared collection link.
- Allow users to download a single document from a shared document link.
- Allow users to download all documents in a shared collection as a ZIP file.
- Maintain security: download endpoints must validate the share token (no authenticated user required).

## API Design

### 1. Download Document from Shared Collection
- **Endpoint:** `GET /api/share/{token}/download/{doc_id}`
- **Auth:** None (uses share token)
- **Logic:**
  1. Validate `token` exists in `collections` table.
  2. Find document `doc_id` within that collection.
  3. Read blob from storage.
  4. Return `Response` with `Content-Disposition: attachment`.
- **Response:** File content (Markdown or HTML).

### 2. Download All Documents in Shared Collection
- **Endpoint:** `GET /api/share/{token}/download`
- **Auth:** None (uses share token)
- **Logic:**
  1. Validate `token` exists in `collections` table.
  2. Query all documents in that collection.
  3. Create an in-memory ZIP file using `zipfile.ZipFile`.
  4. Add each document to the ZIP (using its original filename).
  5. Return ZIP as `Response` with `Content-Disposition: attachment; filename="{collection_name}.zip"`.
- **Response:** ZIP archive containing all documents.

### 3. Download Document from Shared Document
- **Endpoint:** `GET /api/share/doc/{token}/download`
- **Auth:** None (uses document share token)
- **Logic:**
  1. Validate `token` exists in `documents` table.
  2. Read blob from storage.
  3. Return `Response` with `Content-Disposition: attachment`.
- **Response:** File content (Markdown or HTML).

## Frontend Changes

### SharedDocument.tsx
- Add a "Download" button (icon: `Download` from `lucide-react`) next to the existing "Copy Link" button.
- Button links to `GET /api/share/doc/{token}/download`.

### SharedCollection.tsx
- Add a "Download All" button (icon: `Download` from `lucide-react`) at the top of the document list.
- Button links to `GET /api/share/{token}/download`.
- Add individual "Download" buttons for each document in the list.
- Individual buttons link to `GET /api/share/{token}/download/{doc_id}`.

## UI/UX Considerations
- Download buttons should use clear iconography (e.g., `Download` from `lucide-react`).
- For "Download All", consider a loading state or confirmation if the collection is large (optional, not required for MVP).
- Ensure buttons are responsive and align with the existing design system.

## Security
- Share tokens are validated against the database.
- No authenticated user is required for download endpoints.
- Tokens are opaque and non-guessable (generated via `secrets.token_urlsafe`).

## Implementation Notes
- Use `zipfile.ZipFile` and `io.BytesIO` for ZIP creation.
- Handle edge cases: empty collections (return 404 or 400), missing documents (skip or return error).
- Ensure proper HTTP headers for file downloads (`Content-Disposition`, `Content-Type`).

## Files to Modify
- `backend/app/api/share.py` (add download endpoints for collection)
- `backend/app/api/doc_share.py` (add download endpoint for single document)
- `frontend/src/pages/SharedDocument.tsx` (add download button)
- `frontend/src/pages/SharedCollection.tsx` (add download buttons)
