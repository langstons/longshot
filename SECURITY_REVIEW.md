# Security and Code Review Report - Longshot Chrome Extension

**Version Reviewed:** 1.3.6
**Review Date:** 2026-01-27
**Reviewer:** Security Assessment

---

## Executive Summary

Longshot is a Chrome browser extension for capturing full-page screenshots using a scroll-and-stitch method. The extension is well-architected for its purpose but has several security vulnerabilities and code quality issues that should be addressed before wider deployment.

**Risk Level:** MEDIUM

The extension does not exhibit malicious behavior. However, several security practices need improvement, particularly around debug logging, permission scope, and input validation.

---

## Vulnerability Findings

### HIGH Severity

#### 1. Debug Logging Enabled in Production
**Location:** `background.js:6`, `contentScript.js:6`, `offscreen.js:6`
**Risk:** Information Disclosure
**CVSS Score:** 6.5 (Medium-High)

```javascript
const DEBUG = true;
```

**Issue:** Debug mode is enabled in production code, logging sensitive operational data to the browser console including:
- Page dimensions and scroll positions
- Screenshot capture operations
- Element selection details
- Session IDs

**Impact:** Any page script or browser extension with console access can observe these logs, potentially revealing user browsing behavior and captured content metadata.

**Remediation:**
```javascript
const DEBUG = false; // Disable in production
```
Or use build-time environment variables to conditionally enable.

---

#### 2. Overly Broad Host Permissions
**Location:** `manifest.json:14-16`
**Risk:** Excessive Privilege
**CVSS Score:** 6.1

```json
"host_permissions": ["<all_urls>"],
"content_scripts": [{
  "matches": ["<all_urls>"]
}]
```

**Issue:** The extension requests access to ALL websites. While needed for its functionality, this:
- Increases attack surface if extension is compromised
- Allows content script to run on sensitive pages (banking, healthcare)
- Grants broad access that could be abused

**Impact:** If any XSS or code injection vulnerability exists, it could be exploited on any website.

**Remediation:**
- Consider using `activeTab` permission instead of `<all_urls>` for host permissions
- Use programmatic injection (`scripting.executeScript`) only when needed
- Document the permission requirement for users

---

#### 3. Insecure Session ID Generation
**Location:** `background.js:990`, `background.js:1146`, `background.js:1222`, `background.js:1387`
**Risk:** Weak Randomness
**CVSS Score:** 4.3

```javascript
const sessionId = Math.random().toString(36).substring(7);
```

**Issue:** `Math.random()` is not cryptographically secure. Session IDs could potentially be predicted.

**Impact:** While currently session IDs are only used internally for tracking capture state, predictable IDs could be exploited if the extension's functionality expands.

**Remediation:**
```javascript
const sessionId = crypto.randomUUID();
// Or: crypto.getRandomValues(new Uint8Array(16)).reduce((a,b) => a + b.toString(16).padStart(2,'0'), '')
```

---

#### 4. Filename Injection via Page Title
**Location:** `background.js:1027`, `background.js:1170`, `background.js:1250`, `background.js:1404`
**Risk:** Path Traversal / Filename Spoofing
**CVSS Score:** 5.3

```javascript
const tabTitle = sanitizeForFilename(tab.title || '', 40);
const filename = tabTitle
  ? `${tabTitle}_${hostname}_${timestamp}.png`
  : `capture_${hostname}_${timestamp}.png`;
```

**Issue:** While `sanitizeForFilename()` removes some dangerous characters, `tab.title` is controlled by the web page. A malicious page could:
- Set misleading titles (e.g., "bank_statement_confidential")
- Attempt path traversal (though browser downloads API prevents this)

**Impact:** Users could be tricked into thinking screenshots are from different sources.

**Remediation:**
- Add additional validation for suspicious patterns
- Consider truncating more aggressively
- Add origin indicator that cannot be spoofed

---

### MEDIUM Severity

#### 5. Automatic Button Clicking Functionality
**Location:** `contentScript.js:425-471`
**Risk:** Unintended Actions
**CVSS Score:** 5.0

```javascript
async function expandElements() {
  const patterns = ['show more', 'expand', 'view more', 'load more', ...];
  // ...
  element.click();
}
```

**Issue:** The `expandElements()` function automatically clicks buttons matching certain patterns. While there's a blocklist for dangerous words, a malicious page could:
- Create buttons with matching text that trigger unwanted actions
- Use Unicode lookalikes to bypass the blocklist
- Trigger JavaScript handlers that perform unintended operations

**Impact:** Could inadvertently trigger actions on pages when pre-capture stabilization is enabled.

**Remediation:**
- Add more comprehensive blocklist patterns
- Consider click confirmation for detected buttons
- Add rate limiting on clicks
- Check button's form submission status
- Validate button is not inside a form

---

#### 6. Missing Content-Security-Policy
**Location:** `popup.html`, `offscreen.html`
**Risk:** XSS Mitigation Gap
**CVSS Score:** 4.0

**Issue:** HTML files lack explicit Content-Security-Policy headers/meta tags. While Manifest V3 provides some default CSP protection, explicit policies provide defense-in-depth.

**Remediation:**
Add to HTML files:
```html
<meta http-equiv="Content-Security-Policy" content="default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline';">
```

---

#### 7. Silent File Downloads
**Location:** `background.js:1035-1039`, `background.js:1176-1180`
**Risk:** User Awareness Gap
**CVSS Score:** 3.7

```javascript
await chrome.downloads.download({
  url: stitchResult.pngBlobUrl,
  filename,
  saveAs: false  // No user confirmation
});
```

**Issue:** Files are downloaded without user confirmation (`saveAs: false`). Users may not realize a file was saved.

**Impact:** Could lead to cluttered downloads folder or missed downloads.

**Remediation:**
- Consider making `saveAs` a user preference
- Show clear notification when download completes
- Add option to copy to clipboard instead

---

#### 8. Memory Exhaustion Potential
**Location:** `background.js:147`, `offscreen.js:64-68`
**Risk:** Denial of Service
**CVSS Score:** 4.0

```javascript
const MAX_TOTAL_HEIGHT = 32000; // background.js
// Canvas max is 32767 pixels
```

**Issue:** Very tall pages could cause memory issues:
- Multiple large captures in memory simultaneously
- Canvas operations on 32K pixel images
- Blob URL memory not always cleaned up

**Impact:** Could crash browser tab or cause performance issues.

**Remediation:**
- Add memory usage monitoring
- Implement streaming/chunked processing
- Ensure blob URLs are always revoked
- Add user warning for very large captures

---

### LOW Severity

#### 9. Blob URL Memory Leaks
**Location:** `background.js:1042-1048`
**Risk:** Memory Leak
**CVSS Score:** 2.5

```javascript
try {
  if (typeof URL !== 'undefined' && URL.revokeObjectURL) {
    URL.revokeObjectURL(stitchResult.pngBlobUrl);
  }
} catch (e) {
  log('Could not revoke blob URL (expected in service worker):', e.message);
}
```

**Issue:** Blob URLs may not be properly revoked in all cases, especially in error paths.

**Remediation:**
- Use try/finally blocks to ensure cleanup
- Track all created blob URLs
- Implement periodic cleanup

---

#### 10. Error Message Information Disclosure
**Location:** Various error handlers
**Risk:** Information Leak
**CVSS Score:** 2.0

```javascript
throw new Error(`Failed to capture visible tab: ${e.message}`);
```

**Issue:** Detailed error messages are passed to the UI and could reveal internal paths or operational state.

**Remediation:**
- Log detailed errors internally
- Show generic user-friendly messages
- Implement error code system

---

#### 11. Content Script Injected Globally at document_start
**Location:** `manifest.json:48-54`
**Risk:** Performance Impact
**CVSS Score:** 1.5

```json
"content_scripts": [{
  "matches": ["<all_urls>"],
  "js": ["contentScript.js"],
  "run_at": "document_start"
}]
```

**Issue:** Content script is injected on every page at document start, even when capture is not needed.

**Impact:** Minor performance overhead on all page loads.

**Remediation:**
- Use programmatic injection only when needed
- Or change to `document_idle` if early injection not required

---

## Code Quality Issues

### 1. Code Duplication
Multiple similar patterns exist across files (logging setup, sanitization logic, error handling).

**Recommendation:** Extract common utilities to a shared module.

### 2. Magic Numbers
Hardcoded values without named constants:
- `75` (overlap height)
- `600` (capture delay ms)
- `100` (max captures)
- `32000` / `32767` (canvas limits)

**Recommendation:** Define named constants at module level.

### 3. Long Functions
Several functions exceed 100 lines (e.g., `scrollAndStitchCapture`, `elementCapture`).

**Recommendation:** Refactor into smaller, focused functions.

### 4. Missing Input Validation
Message handlers don't validate message structure before accessing properties.

**Recommendation:** Add schema validation for messages.

### 5. Inconsistent Error Handling
Mix of try/catch, Promise rejection, and error returns.

**Recommendation:** Standardize error handling patterns.

---

## CI/CD Security Review

**File:** `.github/workflows/release.yml`

### Findings:

#### Positive:
- Private key stored in GitHub Secrets (not in code)
- Key is deleted after use
- Actions use pinned versions (v4, v3)

#### Areas for Improvement:

1. **Broad Permissions:** Workflow has `contents: write`, `pages: write`, `id-token: write`
   - **Recommendation:** Apply least privilege principle

2. **Key Cleanup:** Uses `rm -f` instead of secure deletion
   - **Recommendation:** Use `shred` or similar for sensitive file deletion:
   ```yaml
   shred -u longshot.pem || rm -f longshot.pem
   ```

3. **Secret Check Method:** Checking secret existence in shell could leak timing
   - **Recommendation:** Use GitHub's native conditional logic

---

## Remediation Plan

### Phase 1: Critical Security Fixes (Immediate - Week 1)

| Priority | Issue | Action | Effort |
|----------|-------|--------|--------|
| P0 | Debug logging | Set `DEBUG = false` in all files | 5 min |
| P0 | Session ID | Replace `Math.random()` with `crypto.randomUUID()` | 15 min |
| P1 | Filename sanitization | Enhance validation, add origin indicator | 1 hour |
| P1 | CSP headers | Add meta CSP to HTML files | 30 min |

### Phase 2: Security Hardening (Week 2-3)

| Priority | Issue | Action | Effort |
|----------|-------|--------|--------|
| P2 | expandElements safety | Add comprehensive blocklist, form detection | 2 hours |
| P2 | Memory management | Add blob URL tracking and cleanup | 3 hours |
| P2 | Error messages | Implement user-friendly error system | 2 hours |
| P2 | Download confirmation | Add saveAs preference option | 1 hour |

### Phase 3: Code Quality (Week 4+)

| Priority | Issue | Action | Effort |
|----------|-------|--------|--------|
| P3 | Code duplication | Create shared utilities module | 4 hours |
| P3 | Magic numbers | Extract to constants | 2 hours |
| P3 | Long functions | Refactor large functions | 4 hours |
| P3 | Input validation | Add message schema validation | 3 hours |

### Phase 4: Architecture Improvements (Future)

| Priority | Issue | Action | Effort |
|----------|-------|--------|--------|
| P4 | Host permissions | Evaluate programmatic injection approach | 8 hours |
| P4 | Content script timing | Move to document_idle or on-demand | 4 hours |
| P4 | CI/CD hardening | Apply least privilege, secure key deletion | 2 hours |

---

## Conclusion

The Longshot extension is **not malware** and serves a legitimate purpose. The codebase demonstrates good understanding of Chrome Extension APIs and image processing. However, several security best practices should be implemented before enterprise deployment or sensitive use cases.

**Key Recommendations:**
1. Disable debug logging immediately
2. Use cryptographically secure random for session IDs
3. Add explicit CSP headers
4. Enhance filename sanitization
5. Improve memory management

After implementing Phase 1 and Phase 2 remediations, the extension would be suitable for general production use.

---

## Appendix: Files Reviewed

- `manifest.json` (60 lines)
- `background.js` (1,456 lines)
- `contentScript.js` (1,224 lines)
- `offscreen.js` (805 lines)
- `popup.js` (383 lines)
- `popup.html` (291 lines)
- `offscreen.html` (17 lines)
- `.github/workflows/release.yml` (195 lines)

**Total Lines of Code:** ~4,431
