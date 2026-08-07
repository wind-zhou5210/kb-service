# Implementation Plan: Share Download Feature

**Date:** 2026-08-05
**Spec:** `docs/superpowers/specs/2026-08-05-share-download-design.md`
**Branch:** `feature/share-download` (to be created)

---

## Phase 1: Backend API (3 endpoints)

### Step 1.1: Single document download from shared document
**File:** `backend/app/api/doc_share.py`
**Action:** Add new endpoint

```
GET /api/share/doc/{token}/download
```

- Validate token against `documents` table
- Read blob from `storage.read(doc.content_sha1)`
- Return `Response` with correct `Content-Disposition` and `Content-Type`
- Follow existing pattern from `documents.py:download_document`

### Step 1.2: Download all docs in shared collection as ZIP
**File:** `backend/app/api/share.py`
**Action:** Add new endpoint

```
GET /api/share/{token}/download
```

- Validate token against `collections` table
- Query all documents in collection
- Create in-memory ZIP with `zipfile.ZipFile` + `io.BytesIO`
- Add each doc using original filename
- Return ZIP with `Content-Disposition: attachment; filename="{collection_name}.zip"`

### Step 1.3: Single document download from shared collection
**File:** `backend/app/api/share.py`
**Action:** Add new endpoint

```
GET /api/share/{token}/download/{doc_id}
```

- Validate token, find doc in collection
- Read blob, return with `Content-Disposition`

**Note:** The `/download` endpoint MUST be defined BEFORE the `/{token}` route to avoid FastAPI path conflicts.

---

## Phase 2: Frontend (2 pages)

### Step 2.1: Add download button to SharedCollection
**File:** `frontend/src/pages/SharedCollection.tsx`

- Add `Download` to `lucide-react` imports
- Add "Download All" button next to "Copy Link" in header
- Add individual "Download" icon button next to each doc's "Copy Link" button
- Use `window.location.href` for download (no JWT needed for public share links)

### Step 2.2: Add download button to SharedDocument
**File:** `frontend/src/pages/SharedDocument.tsx`

- Import `Download` from `lucide-react`
- Import `Button` from `antd`
- Add download button in the top bar next to the title
- Use `window.location.href` for download

---

## Phase 3: Testing & Polish

- Manual test: visit shared doc link → click download → file downloads correctly
- Manual test: visit shared collection link → click individual download → file downloads
- Manual test: visit shared collection link → click "Download All" → ZIP downloads with all files
- Verify no auth is required for any download endpoint
