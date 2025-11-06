# Role-Based Access Control (RBAC) Guide

## Overview

The woven_erp_app implements a comprehensive Role-Based Access Control system that manages user permissions across different modules and sub-applications.

## Fixed Issues

### 1. 401 Authentication Errors (FIXED)
**Problem**: The application sometimes returned 401 errors that were not handled gracefully, causing alerts and poor user experience.

**Root Causes**:
- Initial page load checked `/main/api/current-user` which returned 401 when not logged in
- Error handler showed annoying alerts for normal auth failures
- Session expiry during usage wasn't handled gracefully
- No automatic redirect to login when session expired

**Fixes Applied**:
- ✅ Removed alert on 401 during initial page load check
- ✅ Added graceful 401 handling that just shows login modal
- ✅ Added session expiry detection in all API calls
- ✅ Auto-redirect to login when session expires during usage
- ✅ Removed duplicate `updateLoggedInUserDisplay()` function
- ✅ Consistent use of authentication middleware on all protected endpoints

### 2. RBAC Implementation Issues (FIXED)
**Problem**: RBAC had potential inconsistencies and manual authentication checks.

**Root Causes**:
- Manual `req.session.user` checks in endpoints instead of middleware
- Inconsistent error responses (401 vs 403)
- No centralized authentication logic

**Fixes Applied**:
- ✅ Replaced manual checks with `requireAuth` and `requireAdmin` middleware
- ✅ Consistent 401 responses for authentication failures
- ✅ Consistent 403 responses for authorization failures
- ✅ Improved privilege checking logic
- ✅ Better error messages for debugging

---

## System Architecture

### Roles

The system has two primary roles:

1. **Admin** (`role = 'admin'`)
   - Full access to all modules and features
   - Can manage user privileges
   - Can view all users
   - Access to debug endpoints in development

2. **User** (`role = 'user'`)
   - Access controlled by assigned privileges
   - Can only access modules/sub-apps they have permissions for
   - Cannot manage other users' privileges

### Privileges Structure

Privileges are stored in the `user_privileges` table with the following structure:

```sql
CREATE TABLE user_privileges (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT NOT NULL,
    module VARCHAR(255) NOT NULL,
    sub_ui VARCHAR(255) NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
```

**Naming Convention**:
- `module`: The main module name (e.g., `mis_module`, `orderinformation_module`)
- `sub_ui`: The sub-application name (e.g., `precosting_app`, `poentry_app`)

---

## Authentication Middleware

### `requireAuth`

Ensures the user is logged in.

```javascript
const requireAuth = (req, res, next) => {
    if (!req.session || !req.session.user) {
        return res.status(401).json({
            success: false,
            message: 'Authentication required'
        });
    }
    next();
};
```

**Usage**:
```javascript
app.get('/main/api/current-user', requireAuth, (req, res) => {
    // User is authenticated
});
```

### `requireAdmin`

Ensures the user is logged in AND has admin role.

```javascript
const requireAdmin = (req, res, next) => {
    if (!req.session || !req.session.user) {
        return res.status(401).json({
            success: false,
            message: 'Authentication required'
        });
    }
    if (req.session.user.role !== 'admin') {
        return res.status(403).json({
            success: false,
            message: 'Admin access required'
        });
    }
    next();
};
```

**Usage**:
```javascript
app.get('/main/api/users', requireAdmin, async (req, res) => {
    // User is authenticated AND is admin
});
```

---

## Protected Endpoints

### Authentication Required

| Endpoint | Method | Middleware | Purpose |
|----------|--------|------------|---------|
| `/main/api/current-user` | GET | `requireAuth` | Get current user info |
| `/main/api/logout` | POST | `requireAuth` | Logout current user |

### Admin Only

| Endpoint | Method | Middleware | Purpose |
|----------|--------|------------|---------|
| `/main/api/users` | GET | `requireAdmin` | Get all users |
| `/main/api/user-privileges/:userId` | GET | `requireAdmin` | Get user privileges |
| `/main/api/update-privileges` | POST | `requireAdmin` | Update user privileges |
| `/main/api/debug/*` | GET | `requireAdmin` (prod) | Debug endpoints |

### Public Endpoints

| Endpoint | Method | Middleware | Purpose |
|----------|--------|------------|---------|
| `/main/api/login` | POST | None | User login |
| `/main/api/register` | POST | None | User registration |
| `/main/api/active-users` | GET | None | Get active users count |

---

## Frontend RBAC Implementation

### Privilege Checking

The frontend checks privileges when displaying UI cards:

```javascript
// Admin always has access
if (currentUser.role === 'admin') {
    hasAccess = true;
}
// User needs proper privilege
else if (currentUser.privileges && currentUser.privileges[key]) {
    hasAccess = true;
}

// Disable card if no access
if (!hasAccess) {
    card.classList.add('disabled');
    if (link) link.removeAttribute('href');
}
```

### Privilege Key Format

Privileges are checked using the format: `{module}_{sub_ui}`

**Example**:
- Module: `orderinformation_module`
- Sub-UI: `precosting_app`
- Key: `orderinformation_module_precosting_app`

### Session Expiry Handling

All API calls now handle session expiry gracefully:

```javascript
.then(response => {
    // Handle session expiry
    if (response.status === 401) {
        console.warn('Session expired, redirecting to login');
        currentUser = null;
        document.getElementById('mainContainer').style.display = 'none';
        loginModal.show();
        return null;
    }
    // ... handle response
})
```

---

## Available Modules and Sub-UIs

### MIS Module
- `mis_module` / `orderfollowup_app` - Order Follow Up
- `mis_module` / `floorposition_app` - Floor Position Entry Form
- `mis_module` / `logreport_app` - LOG Report
- `mis_module` / `mainplan_app` - Main Plan

### Order Information Module
- `orderinformation_module` / `precosting_app` - Pre-Costing Form
- `orderinformation_module` / `poentry_app` - PO Entry Form
- `orderinformation_module` / `dispocreate_app` - Dispo Create Form

### Yarn Module
- `yarn_module` / `greigeyarnreceive_app` - Greige Yarn Receive Form
- `yarn_module` / `greigeyarnissue_app` - Greige Yarn Issue Form
- `yarn_module` / `greigeyarnstock_app` - Greige Yarn Stock Report
- `yarn_module` / `dyedyarnreceive_app` - Dyed Yarn Receive Form
- `yarn_module` / `dyedyarnissue_app` - Dyed Yarn Issue Form
- `yarn_module` / `dyedyarnstock_app` - Dyed Yarn Stock Report

### Preparatory Module
- `preparatory_module` / `warpingentry_app` - Warping Entry Form
- `preparatory_module` / `sizingentry_app` - Sizing Entry Form

### Loom Production Module
- `loomproduction_module` / `loomproductionentry_app` - Loom Production Entry Form

### Greige Fabric Module
- `greigefabric_module` / `foldingproduction_app` - Folding Production Entry Form
- `greigefabric_module` / `greigedelivery_app` - Greige Delivery Form
- `greigefabric_module` / `greigefabricstock_app` - Greige Fabric Stock

### Finish Fabric Module
- `finishfabric_module` / `finishfabricreceive_app` - Finish Fabric Receive Entry Form
- `finishfabric_module` / `finishfabricdelivery_app` - Finish Fabric Delivery Entry Form
- `finishfabric_module` / `finishfabricstock_app` - Finish Fabric Stock Report

---

## Admin User Management

### Assigning Privileges

1. Login as admin
2. Click "User Privileges" button
3. Select a user from the dropdown
4. Check/uncheck privileges for that user
5. Click "Save Privileges"

### Privilege Management Features

- ✅ Search/filter privileges by name
- ✅ Select all / deselect all
- ✅ Organized by module
- ✅ Visual feedback during save
- ✅ Error handling and retry logic

---

## Security Best Practices

### Session Security

1. **Session Validation**: All protected endpoints use middleware
2. **Session Expiry**: Handled gracefully on frontend
3. **Auto-logout**: Users redirected to login when session expires
4. **Secure Cookies**: Enabled in production (`secure: true`, `httpOnly: true`, `sameSite: strict`)

### RBAC Security

1. **Server-side Validation**: Never trust client-side privilege checks
2. **Middleware Usage**: Consistent use of `requireAuth` and `requireAdmin`
3. **Least Privilege**: Users get only necessary permissions
4. **Admin Separation**: Admin users clearly identified

### Input Validation

All requests are sanitized via the global input validation middleware:

```javascript
const validateInput = (req, res, next) => {
    // Sanitizes req.body and req.query
    // Removes script tags and XSS attempts
};
```

---

## Troubleshooting

### User Cannot Access Module

**Check**:
1. Is the user logged in? Check session
2. Does the user have the privilege assigned?
3. Is the privilege key correct? (`module_sub_ui`)
4. Is the HTML card using correct `data-module` and `data-sub_ui` attributes?

**Debug**:
```javascript
// Check user privileges
console.log(currentUser.privileges);

// Check card attributes
const card = document.querySelector('.kanban-card');
console.log(card.dataset.module, card.dataset.sub_ui);
```

### 401 Errors

**Causes**:
1. ✅ Session expired - Now handled gracefully
2. ✅ Not logged in - Shows login modal
3. ✅ Endpoint requires auth - Check middleware

**Fix**:
- Login again
- Check that cookies are enabled
- Check session configuration in `.env`

### 403 Errors

**Causes**:
1. User is logged in but not admin
2. Trying to access admin-only endpoint

**Fix**:
- Login with admin account
- Contact admin to get privileges assigned

---

## Testing RBAC

### Test Scenarios

1. **Login/Logout**
   - ✅ Login with valid credentials
   - ✅ Logout successfully
   - ✅ Session persists across page refreshes

2. **Admin Functions**
   - ✅ View all users
   - ✅ Assign privileges to users
   - ✅ Remove privileges from users
   - ✅ Access debug endpoints

3. **User Functions**
   - ✅ Only see authorized modules
   - ✅ Cannot access unauthorized modules
   - ✅ Cannot access admin functions

4. **Session Expiry**
   - ✅ Graceful redirect to login
   - ✅ No annoying alerts
   - ✅ Can login again after expiry

---

## API Response Formats

### Success Response
```json
{
    "success": true,
    "user": {
        "id": 1,
        "username": "john_doe",
        "role": "user",
        "privileges": {
            "orderinformation_module_precosting_app": true,
            "mis_module_orderfollowup_app": true
        }
    }
}
```

### Authentication Error (401)
```json
{
    "success": false,
    "message": "Authentication required"
}
```

### Authorization Error (403)
```json
{
    "success": false,
    "message": "Admin access required"
}
```

### Validation Error (400)
```json
{
    "success": false,
    "error": "Invalid input",
    "details": "Username is required"
}
```

---

## Changes Log

### 2025-11-06: RBAC and Authentication Fixes

**Fixed**:
1. ✅ 401 error handling - no more annoying alerts
2. ✅ Session expiry detection and graceful redirect
3. ✅ Removed duplicate function definitions
4. ✅ Consistent authentication middleware usage
5. ✅ Better error messages and logging
6. ✅ Improved privilege checking logic
7. ✅ Added comprehensive documentation

**Files Modified**:
- `main.js` - Frontend authentication and RBAC
- `server.js` - Backend authentication middleware
- `RBAC_GUIDE.md` - This documentation

---

## Future Enhancements

1. **Role Hierarchy**: Support for multiple role levels
2. **Permission Groups**: Bundle permissions for easier management
3. **Audit Logging**: Track all privilege changes
4. **Time-based Access**: Temporary privilege assignments
5. **IP Restrictions**: Limit access by IP address
6. **2FA**: Two-factor authentication for admin users

---

## Support

For issues or questions:
1. Check the logs in browser console
2. Check server logs for errors
3. Verify environment variables in `.env`
4. Refer to `SECURITY.md` for security best practices
5. Contact development team
